import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { jidToPhone, sendPresence, sendText } from "@/lib/evolution";
import { appendMessage, updateLead, upsertLead } from "@/lib/leads";
import { runSDR } from "@/agent/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do Evolution API.
 *
 * Eventos esperados:
 *  - MESSAGES_UPSERT: nova mensagem recebida.
 *  - CONNECTION_UPDATE / QRCODE_UPDATED: ignoramos por ora (logamos).
 *
 * Segurança: validamos um header `apikey` que precisa bater com EVOLUTION_WEBHOOK_SECRET.
 * (Configure isso no Evolution via WEBHOOK_REQUEST_HEADERS.)
 */
export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get("apikey") ?? req.headers.get("x-webhook-secret");
  // Evolution v2.2.3 ignora WEBHOOK_REQUEST_HEADERS em alguns builds e manda o
  // AUTHENTICATION_API_KEY no header `apikey`. Aceita match com qualquer um dos dois.
  const validSecrets = [env.EVOLUTION_WEBHOOK_SECRET, env.EVOLUTION_API_KEY].filter(Boolean);
  if (secretHeader && !validSecrets.includes(secretHeader)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const event: string | undefined = payload?.event ?? payload?.type;
  const data = payload?.data ?? payload;

  if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
    return NextResponse.json({ ok: true, ignored: event });
  }

  // Forma do data varia: às vezes vem { key, message, pushName }, às vezes array.
  const items: any[] = Array.isArray(data) ? data : [data];

  // Responde já ao Evolution; processa em background.
  queueMicrotask(() => processMessages(items).catch((e) => console.error("[webhook] processMessages", e)));
  return NextResponse.json({ ok: true });
}

async function processMessages(items: any[]) {
  for (const it of items) {
    try {
      await handleOne(it);
    } catch (e) {
      console.error("[webhook] handleOne error:", e);
    }
  }
}

function extractText(message: any): string {
  if (!message) return "";
  if (typeof message === "string") return message;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ""
  );
}

async function handleOne(it: any) {
  const key = it?.key ?? it?.message?.key;
  const message = it?.message ?? it;
  const fromMe: boolean = key?.fromMe ?? false;
  const remoteJid: string | undefined = key?.remoteJid;
  const messageId: string | undefined = key?.id;
  const pushName: string | undefined = it?.pushName ?? it?.message?.pushName;

  if (fromMe || !remoteJid) return;
  // Ignora grupos por ora
  if (remoteJid.endsWith("@g.us")) return;

  const text = extractText(message?.message ?? message);
  if (!text || text.trim().length === 0) return;

  const phone = jidToPhone(remoteJid);
  const lead = await upsertLead(phone, pushName);

  await appendMessage({
    leadId: lead.id,
    direction: "inbound",
    role: "user",
    content: text,
    evolutionMessageId: messageId,
    evolutionEvent: it,
  });

  if (lead.human_takeover) {
    // Humano assumiu — não responde.
    return;
  }

  // Indicador "digitando…"
  sendPresence(phone, "composing").catch(() => {});

  const { reply, needsHandoff, qualification } = await runSDR({
    lead,
    userText: text,
  });

  if (reply) {
    await sendText({ to: phone, text: reply, delayMs: 900 });
    await appendMessage({
      leadId: lead.id,
      direction: "outbound",
      role: "assistant",
      content: reply,
    });
  }

  await updateLead(lead.id, {
    qualification,
    stage: needsHandoff ? "handoff" : undefined,
    status: needsHandoff ? "qualified" : undefined,
    human_takeover: needsHandoff ? true : undefined,
  });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "POST events here from Evolution API." });
}
