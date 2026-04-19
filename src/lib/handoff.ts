import { supabaseAdmin } from "./supabase";
import { sendText } from "./evolution";
import {
  clearCurrentLead,
  getAgentById,
  markAssigned,
  nextInRotation,
  type Agent,
} from "./agents";
import { appendMessage, updateLead } from "./leads";
import { cancelEscalation, scheduleEscalation } from "./handoffQueue";

/**
 * Orquestração do handoff WhatsApp (corretor ↔ Bia ↔ lead).
 *
 * - `initiateHandoff`: chamado no webhook quando a Bia decide handoff. Escolhe
 *   próximo corretor no rodízio, notifica, agenda escalação em 5min.
 * - `escalateHandoff`: dispara quando o timer vence sem `bridge_active`.
 * - `openBridge`: corretor respondeu/comandou, cancela timer, ativa ponte.
 * - `closeBridge`: `/fim` ou retomar Bia. Mantém human_takeover (corretor
 *   decide quando liberar via admin).
 * - `forwardToAgent` / `forwardToLead`: encaminhamentos da ponte.
 */

const REF_PATTERN = /lead:\s*([0-9a-f-]{8,36})/i;

/** Extrai leadId de uma mensagem citada (quoted). Retorna null se não achar. */
export function parseLeadIdFromQuote(quotedText: string | null | undefined): string | null {
  if (!quotedText) return null;
  const m = quotedText.match(REF_PATTERN);
  return m ? m[1] : null;
}

function formatHandoffNotification(args: {
  leadName: string;
  leadPhone: string;
  reason: string;
  brief: string | null;
  leadId: string;
  appBaseUrl: string;
}): string {
  const briefBlock = args.brief ? `\n\n${args.brief}` : "";
  return `🔔 Lead quente — Blackhaus

${args.leadName} (${args.leadPhone})
Motivo: ${args.reason}${briefBlock}

Abrir thread: ${args.appBaseUrl}/admin/leads/${args.leadId}
Responda esta mensagem pra falar com ele (a Bia repassa).

lead: ${args.leadId}`;
}

export async function initiateHandoff(leadId: string, reason = "lead pediu humano") {
  const sb = supabaseAdmin();
  const { data: lead, error } = await sb
    .from("leads")
    .select("id, phone, push_name, full_name, brief, handoff_attempts")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) {
    console.error("[handoff] initiate: lead não encontrado", leadId, error?.message);
    return;
  }

  const agent = await nextInRotation();
  if (!agent) {
    console.warn("[handoff] initiate: nenhum corretor ativo");
    return;
  }

  await notifyAgentAndSchedule({
    agent,
    leadId,
    leadName: lead.full_name || lead.push_name || lead.phone,
    leadPhone: lead.phone,
    brief: lead.brief ?? null,
    reason,
    excludeIds: [agent.id],
    attempts: (lead.handoff_attempts ?? 0) + 1,
  });
}

export async function escalateHandoff(leadId: string) {
  const sb = supabaseAdmin();
  const { data: lead, error } = await sb
    .from("leads")
    .select("id, phone, push_name, full_name, brief, assigned_agent_id, handoff_attempts, bridge_active")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) {
    console.error("[handoff] escalate: lead não encontrado", leadId);
    return;
  }
  if (lead.bridge_active) {
    // Corretor abriu ponte antes do timer rodar — nada a fazer.
    return;
  }

  // Exclui todos os corretores já tentados (por simplicidade, só o atual;
  // poderíamos manter array de tentados, mas rodízio já evita os recentes).
  const excludeIds: string[] = lead.assigned_agent_id ? [lead.assigned_agent_id] : [];
  const next = await nextInRotation(excludeIds);
  if (!next) {
    console.warn("[handoff] escalate: sem próximo corretor disponível", leadId);
    // Flag no lead pra admin ver que handoff falhou.
    await updateLead(leadId, { stage: "handoff_stuck" });
    return;
  }

  await notifyAgentAndSchedule({
    agent: next,
    leadId,
    leadName: lead.full_name || lead.push_name || lead.phone,
    leadPhone: lead.phone,
    brief: lead.brief ?? null,
    reason: "escalado (corretor anterior não respondeu em 5min)",
    excludeIds: [...excludeIds, next.id],
    attempts: (lead.handoff_attempts ?? 0) + 1,
  });
}

async function notifyAgentAndSchedule(args: {
  agent: Agent;
  leadId: string;
  leadName: string;
  leadPhone: string;
  brief: string | null;
  reason: string;
  excludeIds: string[];
  attempts: number;
}) {
  const appBaseUrl = process.env.APP_BASE_URL ?? "https://blackhaus.site";
  const text = formatHandoffNotification({
    leadName: args.leadName,
    leadPhone: args.leadPhone,
    reason: args.reason,
    brief: args.brief,
    leadId: args.leadId,
    appBaseUrl,
  });

  try {
    await sendText({ to: args.agent.phone, text, delayMs: 0 });
  } catch (e) {
    console.error("[handoff] falha ao enviar WhatsApp pro corretor", args.agent.phone, e);
  }

  await updateLead(args.leadId, {
    assigned_agent_id: args.agent.id,
    handoff_notified_at: new Date().toISOString(),
    handoff_attempts: args.attempts,
    bridge_active: false,
  } as Record<string, unknown>);

  await markAssigned(args.agent.id, args.leadId);

  scheduleEscalation({
    leadId: args.leadId,
    onEscalate: escalateHandoff,
  });
}

/** Corretor engajou (respondeu quote ou abriu sessão). Cancela timer e ativa ponte. */
export async function openBridge(leadId: string, agentId: string) {
  cancelEscalation(leadId);
  await updateLead(leadId, {
    bridge_active: true,
    assigned_agent_id: agentId,
  } as Record<string, unknown>);
  await markAssigned(agentId, leadId);
}

export async function closeBridge(leadId: string) {
  cancelEscalation(leadId);
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("leads")
    .select("assigned_agent_id")
    .eq("id", leadId)
    .maybeSingle();
  if (data?.assigned_agent_id) {
    await clearCurrentLead(data.assigned_agent_id);
  }
  await updateLead(leadId, { bridge_active: false } as Record<string, unknown>);
}

/** Corretor escreveu → repassa pro lead. Registra como outbound/assistant. */
export async function forwardToLead(args: {
  leadId: string;
  text: string;
  sendTarget: string;
}) {
  await sendText({ to: args.sendTarget, text: args.text, delayMs: 600 });
  await appendMessage({
    leadId: args.leadId,
    direction: "outbound",
    role: "assistant",
    content: args.text,
  });
}

/** Lead escreveu → repassa pro corretor, com referência pra ele citar. */
export async function forwardToAgent(args: {
  agent: Agent;
  leadName: string;
  leadId: string;
  text: string;
}) {
  const formatted = `💬 ${args.leadName}:\n${args.text}\n\nlead: ${args.leadId}`;
  try {
    await sendText({ to: args.agent.phone, text: formatted, delayMs: 0 });
  } catch (e) {
    console.error("[handoff] falha ao repassar pro corretor", e);
  }
}

/**
 * Resolve qual lead o corretor quer conversar:
 *  1. Se a mensagem tem quote com `lead: <id>`, usa esse.
 *  2. Senão, se existe `/lead <id>` no texto, usa.
 *  3. Senão, se o corretor tem `current_lead_id` gravado, usa.
 */
export async function resolveTargetLead(args: {
  agent: Agent;
  text: string;
  quotedText: string | null;
}): Promise<string | null> {
  const fromQuote = parseLeadIdFromQuote(args.quotedText);
  if (fromQuote) {
    // Pode ser UUID completo ou prefixo — valida.
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("leads")
      .select("id")
      .eq("id", fromQuote)
      .maybeSingle();
    if (data) return data.id as string;
  }
  const cmd = args.text.match(/^\/lead\s+([0-9a-f-]{8,36})/i);
  if (cmd) {
    const sb = supabaseAdmin();
    const { data } = await sb.from("leads").select("id").eq("id", cmd[1]).maybeSingle();
    if (data) return data.id as string;
  }
  if (args.agent.current_lead_id) {
    const fresh = await getAgentById(args.agent.id);
    return fresh?.current_lead_id ?? null;
  }
  return null;
}
