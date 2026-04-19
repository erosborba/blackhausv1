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
import { brPhoneVariants } from "./phone";

/**
 * Orquestração do handoff WhatsApp (corretor ↔ Bia ↔ lead).
 *
 * Identificador humano: usamos o telefone do lead como referência ("lead:
 * 5541995298060"). O JID é stable, curto, e o corretor já reconhece clientes
 * por número — muito melhor que UUID. Internamente, convertemos pra id via
 * lookup no `leads.phone`.
 */

// Telefone BR (12-13 dígitos) ou UUID (fallback pra referências antigas).
const PHONE_REF_PATTERN = /lead:\s*(\d{10,13})/i;
const UUID_REF_PATTERN = /lead:\s*([0-9a-f]{8}-[0-9a-f-]{20,28})/i;

/** Extrai referência (telefone ou UUID) de uma mensagem citada. */
export function parseLeadRefFromQuote(quotedText: string | null | undefined): string | null {
  if (!quotedText) return null;
  const phone = quotedText.match(PHONE_REF_PATTERN);
  if (phone) return phone[1];
  const uuid = quotedText.match(UUID_REF_PATTERN);
  if (uuid) return uuid[1];
  return null;
}

/** Resolve uma ref (telefone ou UUID) pra lead.id. */
export async function leadIdFromRef(ref: string): Promise<string | null> {
  const sb = supabaseAdmin();
  if (/^\d{10,13}$/.test(ref)) {
    const variants = brPhoneVariants(ref);
    const { data } = await sb
      .from("leads")
      .select("id")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  const { data } = await sb.from("leads").select("id").eq("id", ref).maybeSingle();
  return (data?.id as string | undefined) ?? null;
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

${args.leadName} · ${args.leadPhone}
Motivo: ${args.reason}${briefBlock}

Abrir thread: ${args.appBaseUrl}/admin/leads/${args.leadId}
Responda esta mensagem pra falar com ele (a Bia repassa).

lead: ${args.leadPhone}`;
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
  if (lead.bridge_active) return;

  const excludeIds: string[] = lead.assigned_agent_id ? [lead.assigned_agent_id] : [];
  const next = await nextInRotation(excludeIds);
  if (!next) {
    console.warn("[handoff] escalate: sem próximo corretor disponível", leadId);
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

  console.log("[handoff] notify", {
    agentPhone: args.agent.phone,
    agentId: args.agent.id,
    leadId: args.leadId,
    leadPhone: args.leadPhone,
    attempt: args.attempts,
  });

  try {
    await sendText({ to: args.agent.phone, text, delayMs: 0 });
  } catch (e) {
    console.error("[handoff] falha ao enviar WhatsApp pro corretor", args.agent.phone, e);
  }

  try {
    await updateLead(args.leadId, {
      assigned_agent_id: args.agent.id,
      handoff_notified_at: new Date().toISOString(),
      handoff_attempts: args.attempts,
      bridge_active: false,
      bridge_closed_at: null,
    } as Record<string, unknown>);
  } catch (e) {
    console.error("[handoff] updateLead (notify) FAILED:", e instanceof Error ? e.message : e);
  }

  try {
    await markAssigned(args.agent.id, args.leadId);
  } catch (e) {
    console.error("[handoff] markAssigned FAILED:", e);
  }

  scheduleEscalation({
    leadId: args.leadId,
    onEscalate: escalateHandoff,
  });
  console.log("[handoff] escalation scheduled for", args.leadId);
}

export async function openBridge(leadId: string, agentId: string) {
  cancelEscalation(leadId);
  await updateLead(leadId, {
    bridge_active: true,
    assigned_agent_id: agentId,
    bridge_closed_at: null,
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
  await updateLead(leadId, {
    bridge_active: false,
    bridge_closed_at: new Date().toISOString(),
  } as Record<string, unknown>);
}

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

/**
 * Lead escreveu → repassa pro corretor. `mode` controla a copy:
 *  - "bridge": ponte ativa, só o texto limpo
 *  - "waiting": corretor notificado mas ainda não engajou
 *  - "closed": corretor deu /fim mas lead continua pausado (nova msg do lead)
 */
export async function forwardToAgent(args: {
  agent: Agent;
  leadName: string;
  leadPhone: string;
  leadId: string;
  text: string;
  mode: "bridge" | "waiting" | "closed";
}) {
  let prefix = "";
  let suffix = "";
  if (args.mode === "waiting") {
    prefix = "⏳ (aguardando você abrir a ponte)\n";
  } else if (args.mode === "closed") {
    prefix = "💭 (ponte encerrada — cliente falou de novo)\n";
    suffix = `\n\nReabrir: responda esta mensagem ou envie "/lead ${args.leadPhone}".`;
  }

  const formatted = `${prefix}💬 ${args.leadName}:\n${args.text}${suffix}\n\nlead: ${args.leadPhone}`;
  try {
    await sendText({ to: args.agent.phone, text: formatted, delayMs: 0 });
  } catch (e) {
    console.error("[handoff] falha ao repassar pro corretor", e);
  }
}

/**
 * Resolve qual lead o corretor quer conversar:
 *  1. Quote com `lead: <phone|uuid>` → lookup.
 *  2. `/lead <phone|uuid>` no texto.
 *  3. `agent.current_lead_id` (sessão ativa, limpa por /fim).
 *  4. Ponte ainda ativa atribuída a este corretor (defesa contra dessincronização).
 */
export async function resolveTargetLead(args: {
  agent: Agent;
  text: string;
  quotedText: string | null;
}): Promise<string | null> {
  const fromQuote = parseLeadRefFromQuote(args.quotedText);
  console.log("[resolve] quote parse", { fromQuote, quotedText: args.quotedText?.slice(0, 160) ?? null });
  if (fromQuote) {
    const id = await leadIdFromRef(fromQuote);
    if (id) return id;
  }
  const cmd = args.text.match(/^\/lead\s+(\S+)/i);
  if (cmd) {
    const id = await leadIdFromRef(cmd[1]);
    if (id) return id;
  }
  const fresh = await getAgentById(args.agent.id);
  if (fresh?.current_lead_id) {
    console.log("[resolve] using agent.current_lead_id", fresh.current_lead_id);
    return fresh.current_lead_id;
  }
  const sb = supabaseAdmin();
  const { data: active } = await sb
    .from("leads")
    .select("id")
    .eq("assigned_agent_id", args.agent.id)
    .eq("bridge_active", true)
    .order("handoff_notified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active) {
    console.log("[resolve] using active bridge", active.id);
    return active.id as string;
  }
  return null;
}
