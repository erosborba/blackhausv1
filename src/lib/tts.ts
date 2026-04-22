/**
 * Vanguard · Track 4 · Slice 4.1 — client ElevenLabs (TTS outbound).
 *
 * Gera mp3 a partir de texto usando a API da ElevenLabs e cacheia o
 * resultado no bucket `tts-cache` por hash sha256(voice+model+text).
 * Saudações e bordões ("oi!", "já te retorno", "bom dia!") se repetem
 * pra cada lead novo — chamar a API toda vez é desperdício. O cache
 * acerta em O(1) e vira um no-op de latência.
 *
 * Consumo:
 *   const mp3 = await synthesize("Oi, tudo bem?");
 *   // mp3 é Buffer pronto pra virar base64 e ir pro Evolution sendMedia.
 *
 * Observabilidade: todo miss loga em `ai_usage_log` com
 * provider='elevenlabs' task='tts_synthesize', duração e custo calculado
 * via `costUsdOverride` (pricing é $/char, não $/token). Hit NÃO loga —
 * não gastou token, só bytes.
 *
 * Fail-soft: nada aqui lança erros silenciosamente. Caller decide se
 * captura e cai pra texto (slice 4.4 implementa o fallback). Em 4.1, o
 * contrato é "devolve Buffer ou throw".
 *
 * ---
 *
 * Separação pura × impura:
 *   - `ttsCacheKey(...)`         → pura (hash determinístico, testável)
 *   - `computeTtsCostUsd(...)`   → pura (aplica tabela de pricing)
 *   - `synthesize(...)`          → I/O (storage + fetch + logUsage)
 *
 * Mirror da convenção do Track 3 (ver `copilot-handoff.ts`): o módulo
 * puro não importa supabase nem env, então pode ser carregado em
 * node:test sem mock. A impureza fica no wrapper.
 */
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import { logUsage } from "./ai-usage";
import { getSetting } from "./settings";
import { ttsCacheKey, computeTtsCostUsd } from "./tts-pure";

// Re-export pra manter interface única ("import from tts").
export { ttsCacheKey, computeTtsCostUsd };

const BUCKET = "tts-cache";
const API_BASE = "https://api.elevenlabs.io/v1";

// ---------------------------------------------------------------------------
// Impure: synthesize (cache → API → cache)
// ---------------------------------------------------------------------------

export type SynthesizeInput = {
  text: string;
  voiceId?: string;        // default env.ELEVENLABS_VOICE_ID
  model?: string;          // default env.ELEVENLABS_MODEL
  leadId?: string | null;  // logging only
};

export type SynthesizeResult = {
  buffer: Buffer;
  cacheHit: boolean;
  cacheKey: string;
  bytes: number;
};

/**
 * Gera (ou reaproveita) o mp3. Fluxo:
 *   1. Calcula hash → tenta download no bucket `tts-cache/{hash}.mp3`.
 *   2. Hit → devolve buffer + `cacheHit:true`. Sem log (não gastou API).
 *   3. Miss → chama ElevenLabs /text-to-speech/{voiceId}, sobe pro cache,
 *      loga `ai_usage_log` com custo por char.
 *
 * Lança Error em caso de falha da API. Caller captura pra fallback.
 */
export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  const text = input.text.trim();
  if (!text) throw new Error("synthesize: texto vazio");

  // Precedência: arg explícito > setting no DB > env. Setting permite
  // trocar voz sem redeploy; env é o fallback pra ambientes sem DB
  // (scripts, tests). Falha silenciosamente na leitura do setting pra
  // não derrubar TTS por causa de DB glitch.
  const voiceFromSetting = input.voiceId
    ? null
    : await getSetting("tts_voice_id", "").catch(() => "");
  const voiceId =
    input.voiceId ?? (voiceFromSetting || env.ELEVENLABS_VOICE_ID);
  const model = input.model ?? env.ELEVENLABS_MODEL;
  const key = ttsCacheKey({ text, voiceId, model });
  const path = `${key}.mp3`;

  // 1) Tenta cache.
  const cached = await downloadFromCache(path);
  if (cached) {
    return { buffer: cached, cacheHit: true, cacheKey: key, bytes: cached.length };
  }

  // 2) Miss → chama API.
  const t0 = Date.now();
  try {
    const buffer = await callElevenLabs({ text, voiceId, model });
    // 3) Sobe pro cache (não bloqueia retorno em caso de falha do upload:
    //    logamos e seguimos — o callee só quer o buffer).
    uploadToCache(path, buffer).catch((e) => {
      console.error(`[tts] cache upload falhou (${path}):`, e);
    });

    logUsage({
      provider: "elevenlabs",
      model,
      task: "tts_synthesize",
      durationMs: Date.now() - t0,
      leadId: input.leadId,
      ok: true,
      costUsdOverride: computeTtsCostUsd(text.length),
      metadata: {
        chars: text.length,
        voice_id: voiceId,
        cache_key: key,
        bytes: buffer.length,
      },
    });

    return { buffer, cacheHit: false, cacheKey: key, bytes: buffer.length };
  } catch (e) {
    logUsage({
      provider: "elevenlabs",
      model,
      task: "tts_synthesize",
      durationMs: Date.now() - t0,
      leadId: input.leadId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      metadata: { chars: text.length, voice_id: voiceId },
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cache helpers — fail-soft no download (miss vira null, erro de rede
// também — melhor tentar de novo via API do que explodir).
// ---------------------------------------------------------------------------

async function downloadFromCache(path: string): Promise<Buffer | null> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    const arr = await data.arrayBuffer();
    return Buffer.from(arr);
  } catch (e) {
    console.warn(`[tts] cache download falhou (${path}):`, e);
    return null;
  }
}

async function uploadToCache(path: string, buffer: Buffer): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "audio/mpeg", upsert: false });
  // upsert:false = se duas chamadas concorrentes geraram o mesmo hash
  // em paralelo, a segunda ganha um erro "already exists" — é ok, o
  // blob já tá lá, próxima chamada pega via cache hit.
  if (error && !/exists/i.test(error.message)) {
    throw new Error(`tts upload ${path}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// API call — ElevenLabs text-to-speech endpoint.
// ---------------------------------------------------------------------------

async function callElevenLabs(args: {
  text: string;
  voiceId: string;
  model: string;
}): Promise<Buffer> {
  const url = `${API_BASE}/text-to-speech/${encodeURIComponent(args.voiceId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: args.text,
      model_id: args.model,
      // Voice settings calibrados pra SDR: estabilidade média (pra não
      // soar robótico), similaridade alta (manter identidade da voz),
      // style 0 (sem exagerar emoção — Bia é calma).
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }

  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);
  if (buffer.length === 0) throw new Error("ElevenLabs: buffer vazio");
  return buffer;
}
