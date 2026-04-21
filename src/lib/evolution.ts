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

type SendDocumentInput = {
  to: string;
  mediaBase64: string;        // base64 puro, sem data-URL prefix
  fileName: string;           // ex: "visita-jardim-das-acacias.ics"
  mimetype?: string;          // default text/calendar
  caption?: string;
  delayMs?: number;
};

/**
 * Envia arquivo anexado no WhatsApp. Usado pra mandar `.ics` junto com
 * a confirmação de visita (Slice 2.2' — alternativa ao Google Calendar):
 * o lead toca no arquivo, abre no calendar nativo do celular, evento
 * entra sem a gente precisar de OAuth.
 */
export async function sendDocument({
  to,
  mediaBase64,
  fileName,
  mimetype = "text/calendar",
  caption,
  delayMs = 800,
}: SendDocumentInput) {
  return evoFetch(`/message/sendMedia/${env.EVOLUTION_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number: to,
      mediatype: "document",
      mimetype,
      media: mediaBase64,
      fileName,
      caption: caption ?? "",
      delay: delayMs,
    }),
  });
}

export async function sendPresence(to: string, presence: "composing" | "paused" = "composing") {
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
