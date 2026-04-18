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
