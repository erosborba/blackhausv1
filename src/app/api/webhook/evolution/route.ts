import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { jidToPhone, sendPresence, sendText } from "@/lib/evolution";
import { appendMessage, updateLead, upsertLead, type Lead } from "@/lib/leads";
import { runSDR } from "@/agent/graph";
import { scheduleInbound } from "@/lib/debounce";
import { generateBrief } from "@/lib/brief";
import { getAgentByPhone, isAgentPhone } from "@/lib/agents";
import {
  closeBridge,
  forwardToAgent,
  forwardToLead,
  initiateHandoff,
  openBridge,
  resolveTargetLead,
} from "@/lib/handoff";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do Evolution API.
 *
 * Roteamento:
 *  1. Se o remetente é um corretor cadastrado em `agents`, vai pro fluxo
 *     de ponte (responde a lead, /fim, /lead <id>, /status).
 *  2. Se é lead com `bridge_active`, encaminhamos pro corretor (sem LLM).
 *  3. Se é lead com `human_takeover`, ignoramos (corretor vai responder pelo admin).
 *  4. Caso contrário, roda o agente (debounce + LLM).
 *
 * Segurança: `apikey` header precisa bater com EVOLUTION_WEBHOOK_SECRET ou
 * EVOLUTION_API_KEY.
 */
export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get("apikey") ?? req.headers.get("x-webhook-secret");
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

  const items: any[] = Array.isArray(data) ? data : [data];

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

/** Texto da mensagem citada (quando o usuário usa "Responder" no WhatsApp). */
function extractQuotedText(message: any): string | null {
  const ctx = message?.extendedTextMessage?.contextInfo ?? message?.contextInfo;
  const quoted = ctx?.quotedMessage;
  if (!quoted) return null;
  return extractText(quoted) || null;
}

async function handleOne(it: any) {
  const key = it?.key ?? it?.message?.key;
  const message = it?.message ?? it;
  const fromMe: boolean = key?.fromMe ?? false;
  const remoteJid: string | undefined = key?.remoteJid;
  const messageId: string | undefined = key?.id;
  const pushName: string | undefined = it?.pushName ?? it?.message?.pushName;

  if (fromMe || !remoteJid) return;
  if (remoteJid.endsWith("@g.us")) return;

  const innerMessage = message?.message ?? message;
  const text = extractText(innerMessage);
  if (!text || text.trim().length === 0) return;
  const quotedText = extractQuotedText(innerMessage);

  // Resolve @lid → JID real.
  let realJid: string = remoteJid;
  if (remoteJid.endsWith("@lid")) {
    const resolved =
      key?.remoteJidAlt ||
      key?.senderPn ||
      key?.participantPn ||
      it?.senderPn ||
      it?.sender ||
      it?.participant;
    if (resolved) realJid = resolved;
    else console.warn("[webhook] @lid não resolvido, usando LID:", JSON.stringify(it).slice(0, 2000));
  }
  const phone = jidToPhone(realJid);
  if (!phone || phone.length < 8) {
    console.warn("[webhook] phone inválido:", { remoteJid, realJid, phone });
    return;
  }
  const sendTarget = realJid.endsWith("@lid") ? realJid : phone;

  const agentHit = await isAgentPhone(phone);
  console.log("[webhook] inbound", {
    phone,
    remoteJid,
    realJid,
    isAgent: agentHit,
    hasQuote: Boolean(quotedText),
    quotedPreview: quotedText?.slice(0, 80) ?? null,
    textPreview: text.slice(0, 80),
  });

  // ── Rota 1: corretor ──
  if (agentHit) {
    // Dump da estrutura da mensagem pra debug de quote (pode sumir depois).
    try {
      console.log(
        "[webhook] agent raw message keys:",
        innerMessage ? Object.keys(innerMessage) : null,
        "contextInfo?",
        Boolean(
          innerMessage?.extendedTextMessage?.contextInfo ?? innerMessage?.contextInfo,
        ),
      );
    } catch {
      /* ignora */
    }
    await handleAgentMessage({ phone, text, quotedText, sendTarget });
    return;
  }

  // ── Rota 2/3/4: lead ──
  const lead = await upsertLead(phone, pushName);

  await appendMessage({
    leadId: lead.id,
    direction: "inbound",
    role: "user",
    content: text,
    evolutionMessageId: messageId,
    evolutionEvent: it,
  });

  // Ponte ativa OU corretor já notificado (aguardando): repassa pro corretor.
  if (lead.assigned_agent_id && (lead.bridge_active || lead.human_takeover)) {
    const agentRow = await supabaseAdmin()
      .from("agents")
      .select("*")
      .eq("id", lead.assigned_agent_id)
      .maybeSingle();
    if (agentRow.data) {
      const prefix = lead.bridge_active ? "" : "⏳ (aguardando você abrir a ponte)\n";
      await forwardToAgent({
        agent: agentRow.data as any,
        leadId: lead.id,
        leadName: lead.full_name || lead.push_name || lead.phone,
        text: prefix + text,
      });
      return;
    }
  }

  if (lead.human_takeover) {
    return;
  }

  sendPresence(sendTarget, "composing").catch(() => {});

  scheduleInbound({
    lead,
    text,
    sendTarget,
    flush: runAgentTurn,
  });
}

async function runAgentTurn(args: { lead: Lead; combinedText: string; sendTarget: string }) {
  const { lead, combinedText, sendTarget } = args;
  sendPresence(sendTarget, "composing").catch(() => {});

  const { reply, needsHandoff, qualification } = await runSDR({
    lead,
    userText: combinedText,
  });

  if (reply) {
    await sendText({ to: sendTarget, text: reply, delayMs: 900 });
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

  if (needsHandoff) {
    // Auto-brief (não bloqueia).
    if (!lead.brief) {
      try {
        const brief = await generateBrief(lead.id);
        await updateLead(lead.id, { brief, brief_at: new Date().toISOString() });
      } catch (e) {
        console.error("[webhook] auto-brief failed:", e instanceof Error ? e.message : e);
      }
    }
    // Dispara notificação pro corretor da vez (fire-and-forget).
    initiateHandoff(lead.id, "Bia detectou que precisa de humano").catch((e) =>
      console.error("[webhook] initiateHandoff failed:", e),
    );
  }
}

/**
 * Mensagem de um corretor. Comandos:
 *  - `/fim` ou `/sair`: fecha a ponte (lead volta a esperar resposta manual).
 *  - `/status`: lista leads pendentes/ativos do corretor.
 *  - `/lead <id>` (prefix 8+): abre sessão com esse lead.
 *  - Quote de notificação (ou mensagem repassada): Bia repassa texto ao lead.
 *  - Texto solto: usa sessão aberta, senão orienta.
 */
async function handleAgentMessage(args: {
  phone: string;
  text: string;
  quotedText: string | null;
  sendTarget: string;
}) {
  const agent = await getAgentByPhone(args.phone);
  console.log("[agent-msg] start", {
    phone: args.phone,
    agentFound: Boolean(agent),
    agentId: agent?.id,
    currentLeadId: agent?.current_lead_id ?? null,
    hasQuote: Boolean(args.quotedText),
    text: args.text.slice(0, 120),
  });
  if (!agent) return;

  const t = args.text.trim();

  if (/^\/(fim|sair)\b/i.test(t)) {
    let targetLeadId: string | null = agent.current_lead_id;
    if (!targetLeadId) {
      // Sincroniza: procura ponte aberta atribuída a este corretor.
      const sb = supabaseAdmin();
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("assigned_agent_id", agent.id)
        .eq("bridge_active", true)
        .limit(1)
        .maybeSingle();
      targetLeadId = (data?.id as string | undefined) ?? null;
    }
    if (targetLeadId) {
      await closeBridge(targetLeadId);
      await sendText({
        to: agent.phone,
        text: `✅ Ponte encerrada. Lead continua pausado no admin — retome a Bia por lá se quiser.`,
        delayMs: 0,
      });
    } else {
      await sendText({ to: agent.phone, text: "Sem ponte ativa.", delayMs: 0 });
    }
    return;
  }

  if (/^\/status\b/i.test(t)) {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("leads")
      .select("id, phone, push_name, full_name, bridge_active, handoff_notified_at")
      .eq("assigned_agent_id", agent.id)
      .order("handoff_notified_at", { ascending: false })
      .limit(10);
    const lines = (data ?? []).map((l) => {
      const name = l.full_name || l.push_name || l.phone;
      const state = l.bridge_active ? "🟢 ponte" : "🟡 aguardando";
      return `${state} ${name} — lead: ${l.id}`;
    });
    await sendText({
      to: agent.phone,
      text: lines.length > 0 ? lines.join("\n") : "Sem leads atribuídos.",
      delayMs: 0,
    });
    return;
  }

  const targetLeadId = await resolveTargetLead({
    agent,
    text: t,
    quotedText: args.quotedText,
  });
  console.log("[agent-msg] resolve", { targetLeadId, quotedText: args.quotedText?.slice(0, 160) });

  if (!targetLeadId) {
    await sendText({
      to: agent.phone,
      text: `Não entendi qual lead. Opções:
• Use "Responder" numa notificação minha.
• Ou envie: /lead <id-do-lead>
• Ver pendentes: /status`,
      delayMs: 0,
    });
    return;
  }

  // Abre/confirma ponte e repassa.
  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("id, phone")
    .eq("id", targetLeadId)
    .maybeSingle();
  if (!lead) {
    await sendText({ to: agent.phone, text: "Lead não encontrado.", delayMs: 0 });
    return;
  }

  await openBridge(lead.id, agent.id);

  // Comando `/lead <id>` sem texto adicional: só abre sessão.
  const cmdOnly = t.match(/^\/lead\s+[0-9a-f-]{8,36}\s*$/i);
  if (cmdOnly) {
    await sendText({
      to: agent.phone,
      text: `✅ Sessão aberta. Próximas mensagens vão pro lead. Use /fim pra encerrar.`,
      delayMs: 0,
    });
    return;
  }

  // Remove o comando do texto se presente.
  const cleanText = t.replace(/^\/lead\s+[0-9a-f-]{8,36}\s*/i, "").trim();
  if (!cleanText) return;

  await forwardToLead({
    leadId: lead.id,
    text: cleanText,
    sendTarget: lead.phone,
  });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "POST events here from Evolution API." });
}
