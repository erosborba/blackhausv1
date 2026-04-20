import Anthropic from "@anthropic-ai/sdk";
import { toFile } from "openai/uploads";
import { env } from "./env";
import { openai } from "./openai";
import { supabaseAdmin } from "./supabase";
import { anthropicUsage, logUsage } from "./ai-usage";
import { getSettingNumber } from "./settings";

/**
 * Multimodal helpers: download de mídia do Evolution, upload no storage,
 * transcrição de áudio (Whisper) e descrição de imagem (Claude vision).
 *
 * Fluxo típico no webhook:
 *   1. Detecta audioMessage/imageMessage no payload.
 *   2. downloadFromEvolution(messageId) → Buffer.
 *   3. uploadMedia({...}) → path em messages-media.
 *   4. transcribeAudio / describeImage → string pro content da mensagem.
 *   5. appendMessage com content + media_type/path/mime.
 *
 * Cada função é isolada; se falha, caller decide fallback (auto-reply, skip, etc).
 */

const BUCKET = "messages-media";
const AUDIO_MODEL = "whisper-1";
const VISION_MODEL = "claude-haiku-4-5";

// Whisper-1 é billing por segundo ($0.006/minuto). Pré-calculamos aqui pra
// meter em `cost_usd` direto no log (a pricing table em ai-usage.ts é
// token-based e não se encaixa).
const WHISPER_COST_PER_SECOND = 0.006 / 60;

export type MediaType = "audio" | "image" | "video";

export type DetectedMedia = {
  type: MediaType;
  mime: string;
  caption?: string | null;
  durationMs?: number | null;
};

/**
 * Inspeciona o payload da mensagem e decide se é mídia processável.
 * Retorna `null` pra texto puro (fluxo atual segue normal).
 */
export function detectMedia(innerMessage: any): DetectedMedia | null {
  if (!innerMessage || typeof innerMessage !== "object") return null;

  const audio = innerMessage.audioMessage;
  if (audio) {
    return {
      type: "audio",
      mime: audio.mimetype ?? "audio/ogg",
      durationMs: typeof audio.seconds === "number" ? audio.seconds * 1000 : null,
    };
  }

  const image = innerMessage.imageMessage;
  if (image) {
    return {
      type: "image",
      mime: image.mimetype ?? "image/jpeg",
      caption: image.caption ?? null,
    };
  }

  // Vídeo detectado mas não processado (só caption vira texto; blob segue pro storage).
  const video = innerMessage.videoMessage;
  if (video) {
    return {
      type: "video",
      mime: video.mimetype ?? "video/mp4",
      caption: video.caption ?? null,
      durationMs: typeof video.seconds === "number" ? video.seconds * 1000 : null,
    };
  }

  return null;
}

/**
 * Baixa a mídia decriptada do Evolution. A API Baileys entrega URLs cifradas;
 * o endpoint `getBase64FromMediaMessage` devolve base64 pronto.
 */
export async function downloadFromEvolution(messageId: string): Promise<Buffer> {
  const url = `${env.EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/${env.EVOLUTION_INSTANCE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({ message: { key: { id: messageId } } }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution getBase64 ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { base64?: string };
  if (!json.base64) throw new Error("Evolution getBase64: resposta sem base64");
  return Buffer.from(json.base64, "base64");
}

/**
 * Sobe o blob pro bucket `messages-media`. Path convencionado:
 *   {type}/{messageId}.{ext}
 * messageId (evolution_message_id) é globalmente único — não precisa
 * particionar por lead. `leadId` permanece na tabela messages pra joins.
 */
export async function uploadMedia(args: {
  messageId: string;
  type: MediaType;
  mime: string;
  buffer: Buffer;
}): Promise<string> {
  const ext = extFromMime(args.mime, args.type);
  const path = `${args.type}/${args.messageId}.${ext}`;
  const sb = supabaseAdmin();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, args.buffer, { contentType: args.mime, upsert: true });
  if (error) throw new Error(`upload ${path} falhou: ${error.message}`);
  return path;
}

/**
 * Gera URL assinada temporária pra reproduzir áudio / exibir imagem no admin.
 * TTL curto por segurança (15min). Chamado on-demand pelo API route.
 */
export async function signMediaUrl(path: string, expiresInSec = 900): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresInSec);
  if (error || !data) throw new Error(`signUrl ${path}: ${error?.message ?? "sem data"}`);
  return data.signedUrl;
}

/**
 * Transcreve áudio com Whisper-1. Forçamos idioma "pt" pra acelerar e evitar
 * falsos positivos em línguas latinas. max_size é validado antes de chamar.
 */
export async function transcribeAudio(args: {
  buffer: Buffer;
  mime: string;
  durationMs?: number | null;
  leadId?: string;
}): Promise<string> {
  const t0 = Date.now();
  try {
    const ext = extFromMime(args.mime, "audio");
    const file = await toFile(args.buffer, `audio.${ext}`, { type: args.mime });
    const r = await openai().audio.transcriptions.create({
      model: AUDIO_MODEL,
      file,
      language: "pt",
    });
    const text = (r.text ?? "").trim();

    const seconds = (args.durationMs ?? 0) / 1000;
    const cost = seconds > 0 ? seconds * WHISPER_COST_PER_SECOND : 0;
    logUsage({
      provider: "openai",
      model: AUDIO_MODEL,
      task: "audio_transcribe",
      durationMs: Date.now() - t0,
      leadId: args.leadId,
      ok: true,
      // Whisper é $/segundo, não $/token — o `computeCostUsd` não cobre.
      // Mandamos o valor já calculado via override pra cost_usd refletir no
      // dashboard sem precisar adicionar Whisper à tabela de pricing.
      costUsdOverride: cost,
      metadata: {
        audio_seconds: Math.round(seconds),
        chars: text.length,
      },
    });

    if (!text) throw new Error("transcrição vazia");
    return text;
  } catch (e) {
    logUsage({
      provider: "openai",
      model: AUDIO_MODEL,
      task: "audio_transcribe",
      durationMs: Date.now() - t0,
      leadId: args.leadId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Descreve imagem com Haiku vision. Contexto: SDR imobiliário — pedimos pra
 * focar em elementos relevantes (print de anúncio, foto de imóvel, documento,
 * rosto/pessoa, etc). Saída é 1-3 frases que viram o texto pra Bia processar.
 */
export async function describeImage(args: {
  buffer: Buffer;
  mime: string;
  caption?: string | null;
  leadId?: string;
}): Promise<string> {
  const t0 = Date.now();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const system = `Você descreve imagens enviadas por leads de uma imobiliária em Curitiba via WhatsApp.
Responda em 1-3 frases, em PT-BR, focando em:
- Se é print de outro anúncio imobiliário: extraia preço, localização, metragem, quartos se visíveis.
- Se é foto de imóvel (próprio ou para comparação): descreva tipo, ambiente, estado aparente.
- Se é documento (comprovante, holerite, extrato): identifique o tipo sem ler dados sensíveis.
- Se é selfie / pessoa / meme / coisa aleatória: diga brevemente.
- Se tem texto legível e relevante, transcreva o essencial.

Não invente detalhes. Se não conseguir distinguir, diga que é uma imagem inconclusiva.`;

  try {
    const resp = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 400,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: normalizeImageMime(args.mime),
                data: args.buffer.toString("base64"),
              },
            },
            {
              type: "text",
              text: args.caption
                ? `O lead enviou esta imagem com a legenda: "${args.caption}". Descreva a imagem.`
                : "O lead enviou esta imagem sem legenda. Descreva.",
            },
          ],
        },
      ],
    });

    const desc = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();

    logUsage({
      provider: "anthropic",
      model: VISION_MODEL,
      task: "image_vision",
      ...anthropicUsage(resp),
      durationMs: Date.now() - t0,
      leadId: args.leadId,
      ok: true,
    });

    if (!desc) throw new Error("vision retornou vazio");
    return desc;
  } catch (e) {
    logUsage({
      provider: "anthropic",
      model: VISION_MODEL,
      task: "image_vision",
      durationMs: Date.now() - t0,
      leadId: args.leadId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** Valida tamanho do buffer contra setting media_max_size_mb. */
export async function enforceMaxSize(buffer: Buffer): Promise<void> {
  const maxMb = await getSettingNumber("media_max_size_mb", 20);
  const mb = buffer.length / (1024 * 1024);
  if (mb > maxMb) {
    throw new Error(`mídia ${mb.toFixed(1)}MB excede limite ${maxMb}MB`);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extFromMime(mime: string, fallback: MediaType): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4")) return fallback === "video" ? "mp4" : "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return fallback === "image" ? "jpg" : fallback === "audio" ? "ogg" : "mp4";
}

function normalizeImageMime(mime: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "image/png";
  if (m.includes("webp")) return "image/webp";
  if (m.includes("gif")) return "image/gif";
  return "image/jpeg";
}
