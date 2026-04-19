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
  leadIdFromRef,
  openBridge,
  parseLeadRefFromQuote,
} from "@/lib/handoff";
import { brokerCopilot } from "@/lib/copilot";
import { supabaseAdmin } from "@/lib/supabase";

const HELP_TEXT = `👋 Comandos:
• Responder (quote) uma notificação/mensagem minha → eu repasso pro lead.
• /lead <telefone> <mensagem> — envia pro lead sem precisar de quote.
• /lead <telefone> — abre sessão (sem enviar nada ainda).
• /status — lista seus leads atribuídos.
• /fim — encerra a ponte aberta.
• /help — este menu.

Texto solto (sem quote, sem comando) fica comigo no modo copiloto: te ajudo com contexto, sugestões, resumos dos seus leads.`;

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

/**
 * Texto da mensagem citada (quando o usuário usa "Responder" no WhatsApp).
 *
 * O shape muda por versão de Evolution/Baileys. No nosso (Evolution v2.3.7 +
 * WHATSAPP-BAILEYS), o quote mais comum vem em `item.contextInfo.quotedMessage`
 * (root do item). Em outras versões vai pra `message.extendedTextMessage.contextInfo`.
 * A gente tenta todos os locais conhecidos — primeiro que bater ganha.
 */
function extractQuotedText(message: any, item?: any): string | null {
  const candidates = [
    item?.contextInfo, // Evolution v2 com conversation + contextInfo no root do item
    message?.extendedTextMessage?.contextInfo, // shape "clássico" do Baileys
    message?.contextInfo,
    message?.messageContextInfo?.quotedMessage ? message?.messageContextInfo : null,
    item?.message?.contextInfo,
  ];
  for (const ctx of candidates) {
    const quoted = ctx?.quotedMessage;
    if (quoted) return extractText(quoted) || null;
  }
  return null;
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

  // Idempotência: se já processamos esse evolution_message_id, ignora.
  // Protege contra webhook firando em dobro (ex.: global + per-instance no Evolution,
  // retries da fila, ou dois hosts respondendo simultaneamente durante dev).
  if (messageId) {
    const sb = supabaseAdmin();
    const { data: existing } = await sb
      .from("messages")
      .select("id")
      .eq("evolution_message_id", messageId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log("[webhook] dedup: messageId já processado, ignorando", { messageId });
      return;
    }
  }

  const innerMessage = message?.message ?? message;
  const text = extractText(innerMessage);
  if (!text || text.trim().length === 0) return;
  const quotedText = extractQuotedText(innerMessage, it);

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

  // Ponte ativa OU corretor já notificado (aguardando) OU ponte fechada por /fim.
  if (lead.assigned_agent_id && (lead.bridge_active || lead.human_takeover)) {
    const agentRow = await supabaseAdmin()
      .from("agents")
      .select("*")
      .eq("id", lead.assigned_agent_id)
      .maybeSingle();
    if (agentRow.data) {
      const mode: "bridge" | "waiting" | "closed" = lead.bridge_active
        ? "bridge"
        : (lead as any).bridge_closed_at
        ? "closed"
        : "waiting";
      await forwardToAgent({
        agent: agentRow.data as any,
        leadId: lead.id,
        leadName: lead.full_name || lead.push_name || lead.phone,
        leadPhone: lead.phone,
        text,
        mode,
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
 * Mensagem de um corretor. Defaults invertidos:
 *  - Quote de notificação/mensagem minha → repasso texto pro lead (ponte abre).
 *  - `/lead <telefone> <mensagem>` → envio pro lead sem precisar de quote.
 *  - `/lead <telefone>` (sem texto) → abre sessão silenciosa.
 *  - `/fim`, `/status`, `/help` → comandos locais.
 *  - Texto solto (sem quote, sem comando) → Bia copiloto (não vai pro lead).
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

  // ── Comandos locais ──
  if (/^\/(fim|sair)\b/i.test(t)) {
    let targetLeadId: string | null = agent.current_lead_id;
    if (!targetLeadId) {
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

  if (/^\/help\b/i.test(t)) {
    await sendText({ to: agent.phone, text: HELP_TEXT, delayMs: 0 });
    return;
  }

  if (/^\/status\b/i.test(t)) {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("leads")
      .select("id, phone, push_name, full_name, bridge_active, bridge_closed_at, handoff_notified_at")
      .eq("assigned_agent_id", agent.id)
      .order("handoff_notified_at", { ascending: false })
      .limit(10);
    const lines = (data ?? []).map((l: any) => {
      const name = l.full_name || l.push_name || l.phone;
      const state = l.bridge_active
        ? "🟢 ponte"
        : l.bridge_closed_at
        ? "💭 encerrada"
        : "🟡 aguardando";
      return `${state} ${name} · ${l.phone}`;
    });
    await sendText({
      to: agent.phone,
      text: lines.length > 0
        ? `${lines.join("\n")}\n\nEnviar mensagem: /lead <telefone> <mensagem>`
        : "Sem leads atribuídos.",
      delayMs: 0,
    });
    return;
  }

  // ── Referência explícita a lead? (quote OU /lead <ref>) ──
  const fromQuote = parseLeadRefFromQuote(args.quotedText);
  const cmdMatch = t.match(/^\/lead\s+(\S+)/i);
  const ref = fromQuote ?? cmdMatch?.[1] ?? null;

  if (ref) {
    const leadId = await leadIdFromRef(ref);
    console.log("[agent-msg] resolve ref", { ref, leadId, viaQuote: Boolean(fromQuote) });
    if (!leadId) {
      await sendText({
        to: agent.phone,
        text: `Lead "${ref}" não encontrado. Use /status pra ver atribuídos.`,
        delayMs: 0,
      });
      return;
    }
    const sb = supabaseAdmin();
    const { data: lead } = await sb
      .from("leads")
      .select("id, phone")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) {
      await sendText({ to: agent.phone, text: "Lead não encontrado.", delayMs: 0 });
      return;
    }

    await openBridge(lead.id, agent.id);

    // `/lead <ref>` sem texto (e sem quote) → só abre sessão.
    const cmdOnly = !fromQuote && /^\/lead\s+\S+\s*$/i.test(t);
    if (cmdOnly) {
      await sendText({
        to: agent.phone,
        text: `✅ Ponte aberta. Pra enviar ao lead, responda esta mensagem (quote) ou use /lead ${lead.phone} <texto>. Texto solto fica comigo (copiloto).`,
        delayMs: 0,
      });
      return;
    }

    // Fluxo de aprovação de draft: quote foi de uma mensagem DRAFT da Bia.
    const draftBody = args.quotedText ? parseDraftBody(args.quotedText) : null;
    if (draftBody) {
      const isApproval = APPROVAL_PATTERN.test(t);
      const finalText = isApproval ? draftBody : t;
      console.log("[agent-msg] draft approval", {
        isApproval,
        finalTextPreview: finalText.slice(0, 120),
      });
      await forwardToLead({
        leadId: lead.id,
        text: finalText,
        sendTarget: lead.phone,
      });
      await sendText({
        to: agent.phone,
        text: isApproval ? "✅ Draft aprovado e enviado." : "✅ Sua edição foi enviada.",
        delayMs: 300,
      });
      return;
    }

    // Remove prefixo do comando se veio via /lead <ref> texto.
    const cleanText = t.replace(/^\/lead\s+\S+\s*/i, "").trim();
    if (!cleanText) {
      await sendText({
        to: agent.phone,
        text: "Mande o texto que quer enviar pro lead.",
        delayMs: 0,
      });
      return;
    }

    await forwardToLead({
      leadId: lead.id,
      text: cleanText,
      sendTarget: lead.phone,
    });
    return;
  }

  // ── Texto solto → Bia copiloto ──
  console.log("[agent-msg] copilot → question", { agentId: agent.id, question: t });
  try {
    const { reply, draft } = await brokerCopilot({ agent, text: t });
    console.log("[agent-msg] copilot → reply", {
      agentId: agent.id,
      reply,
      hasDraft: Boolean(draft),
    });
    await sendText({
      to: agent.phone,
      text: reply || "Hmm, não consegui formular. Tenta de novo? /help pra comandos.",
      delayMs: 0,
    });
    if (draft) {
      // Mensagem separada, SÓ o texto do draft (segura+copia limpinho no WhatsApp).
      // Header e footer tão fora do texto principal pra não poluir no copy/paste.
      const confBadge =
        draft.confidence === "alta" ? "🟢" : draft.confidence === "media" ? "🟡" : "🔴";
      const draftMsg = `${DRAFT_MARKER} pro lead ${draft.leadPhone} · confiança ${confBadge} ${draft.confidence}
Responda 👍 pra eu enviar como está, ou responda com a versão editada.

${draft.text}

lead: ${draft.leadPhone}`;
      await sendText({ to: agent.phone, text: draftMsg, delayMs: 800 });
    }
  } catch (e) {
    console.error("[agent-msg] copilot failed:", e instanceof Error ? e.message : e);
    await sendText({
      to: agent.phone,
      text: "Deu ruim aqui no copiloto. Tenta de novo em instantes, ou use /help pra comandos.",
      delayMs: 0,
    });
  }
}

// Marker no início da mensagem de draft. Quando o corretor fizer quote dela,
// a gente detecta e roda o fluxo de aprovação.
const DRAFT_MARKER = "📝 [DRAFT]";

const APPROVAL_PATTERN = /^(\s*(👍|👌|ok|okay|ok!|aprovo|aprovado|aprova|manda|envia|envie|vai|go|beleza|blz|\+1)\s*\.?\s*)$/i;

/** Extrai o corpo (texto proposto) de uma mensagem de draft, dado o quote dela. */
function parseDraftBody(quotedText: string): string | null {
  if (!quotedText.startsWith(DRAFT_MARKER)) return null;
  // Corpo fica entre a linha "Responda 👍 ..." e o footer "lead: XXXX".
  const lines = quotedText.split("\n");
  const instructionIdx = lines.findIndex((l) => l.trim().startsWith("Responda 👍"));
  const footerIdx = lines.findIndex((l) => /^lead:\s*\d+/i.test(l.trim()));
  if (instructionIdx === -1 || footerIdx === -1 || footerIdx <= instructionIdx) return null;
  return lines
    .slice(instructionIdx + 1, footerIdx)
    .join("\n")
    .trim();
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "POST events here from Evolution API." });
}
