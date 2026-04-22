import { env } from "./env";

type SendTextInput = {
  to: string;        // E.164 sem "+", ex: "5511999999999"
  text: string;
  delayMs?: number;
  quotedId?: string;
};

async function evoFetch(path: string, init: RequestInit = {}) {
  const url = `${env.EVOLUTION_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Evolution ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

export async function sendText({ to, text, delayMs = 800, quotedId }: SendTextInput) {
  return evoFetch(`/message/sendText/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      text,
      delay: delayMs,
      ...(quotedId ? { quoted: { key: { id: quotedId } } } : {}),
    }),
  });
}

type MediaType = "image" | "document" | "video" | "audio";

type SendMediaInput = {
  to: string;
  mediatype: MediaType;
  mediaBase64: string;        // base64 puro, sem data-URL prefix
  fileName: string;
  mimetype: string;
  caption?: string;
  delayMs?: number;
};

/**
 * Envia mídia (imagem/documento/vídeo/áudio) pro WhatsApp via Evolution.
 * Wrapper baixo-nível: quem chama monta o base64 + metadata.
 */
export async function sendMedia({
  to,
  mediatype,
  mediaBase64,
  fileName,
  mimetype,
  caption,
  delayMs = 800,
}: SendMediaInput) {
  return evoFetch(`/message/sendMedia/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      mediatype,
      mimetype,
      media: mediaBase64,
      fileName,
      caption: caption ?? "",
      delay: delayMs,
    }),
  });
}

type SendDocumentInput = {
  to: string;
  mediaBase64: string;        // base64 puro, sem data-URL prefix
  fileName: string;           // ex: "visita-jardim-das-acacias.ics"
  mimetype?: string;          // default text/calendar
  caption?: string;
  delayMs?: number;
};

/**
 * Envia documento anexado no WhatsApp. Usado pra .ics de visita e
 * PDFs de booking.
 */
export async function sendDocument({
  to,
  mediaBase64,
  fileName,
  mimetype = "text/calendar",
  caption,
  delayMs = 800,
}: SendDocumentInput) {
  return sendMedia({
    to,
    mediatype: "document",
    mediaBase64,
    fileName,
    mimetype,
    caption,
    delayMs,
  });
}

type SendAudioInput = {
  to: string;
  /**
   * Áudio em base64 puro (sem `data:` prefix). Evolution aceita mp3
   * direto — a Baileys faz o transcode server-side pra ogg/opus antes
   * de subir pro WhatsApp.
   */
  audioBase64: string;
  delayMs?: number;
  quotedId?: string;
};

/**
 * Envia áudio como PTT (push-to-talk / voice note) — bolha de voz com
 * waveform, não anexo de arquivo. Endpoint específico do Evolution:
 * `/message/sendWhatsAppAudio`. O `sendMedia` com `mediatype:"audio"`
 * manda como file attachment, que NÃO é o que queremos pra TTS da Bia.
 *
 * Uso típico (Track 4):
 *   const { buffer } = await synthesize({ text: "oi!" });
 *   await sendAudio({ to: lead.phone, audioBase64: buffer.toString("base64") });
 */
export async function sendAudio({
  to,
  audioBase64,
  delayMs = 800,
  quotedId,
}: SendAudioInput) {
  return evoFetch(`/message/sendWhatsAppAudio/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      audio: audioBase64,
      delay: delayMs,
      ...(quotedId ? { quoted: { key: { id: quotedId } } } : {}),
    }),
  });
}

/**
 * Presences suportadas pela Baileys. `recording` é o "gravando áudio…"
 * que mostramos antes do sendAudio pra mimetizar comportamento humano.
 */
type Presence = "composing" | "recording" | "paused";

export async function sendPresence(to: string, presence: Presence = "composing") {
  return evoFetch(`/chat/sendPresence/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({ number: to, presence, delay: 1200 }),
  });
}

export async function getInstanceStatus() {
  return evoFetch(`/instance/connectionState/${env.EVOLUTION_INSTANCE}`, { method: "GET" });
}

export async function createInstance() {
  return evoFetch(`/instance/create`, {
    method: "POST",
    body: JSON.stringify({
      instanceName: env.EVOLUTION_INSTANCE,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        url: `${env.APP_BASE_URL}/api/webhook/evolution`,
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    }),
  });
}

export async function fetchQrCode() {
  return evoFetch(`/instance/connect/${env.EVOLUTION_INSTANCE}`, { method: "GET" });
}

/** Normaliza o JID do whatsapp em um telefone E.164 sem o "+". */
export function jidToPhone(jid: string): string {
  // ex: 5511999999999@s.whatsapp.net  ->  5511999999999
  return jid.split("@")[0].replace(/\D/g, "");
}
