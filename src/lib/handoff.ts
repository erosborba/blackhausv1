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
import { cancelEscalation, recoverEscalations, scheduleEscalation } from "./handoffQueue";
import { brPhoneVariants } from "./phone";
import { getSettingNumber } from "./settings";
import { cancelFollowUpsForLead } from "./follow-ups";
import {
  HANDOFF_REASON_LABEL,
  HANDOFF_URGENCY_EMOJI,
  type HandoffReason,
  type HandoffUrgency,
} from "@/agent/state";

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
  urgency: HandoffUrgency | null;
  brief: string | null;
  leadId: string;
  appBaseUrl: string;
}): string {
  const briefBlock = args.brief ? `\n\n${args.brief}` : "";
  // Emoji no header destaca urgência pro corretor ler de relance.
  // 🔴 alta, 🟡 média, 🟢 baixa. Sem urgency (ex.: escalação manual) → 🔔 genérico.
  const urgencyBadge = args.urgency ? HANDOFF_URGENCY_EMOJI[args.urgency] : "🔔";
  const urgencyLine = args.urgency ? ` · urgência ${args.urgency}` : "";
  return `${urgencyBadge} Lead quente — Lumihaus${urgencyLine}

${args.leadName} · ${args.leadPhone}
Motivo: ${args.reason}${briefBlock}

Abrir thread: ${args.appBaseUrl}/admin/leads/${args.leadId}
Responda esta mensagem pra falar com ele (a Bia repassa).

lead: ${args.leadPhone}`;
}

/** Restaura timers de escalação após restart. Chame no início do webhook handler. */
export async function recoverHandoffEscalations(): Promise<void> {
  await recoverEscalations(escalateHandoff);
}

export async function initiateHandoff(
  leadId: string,
  /**
   * Motivo canônico do handoff — persiste em `leads.handoff_reason`.
   * Default cobre chamadas legadas/manuais (ex.: botão "escalar" no admin).
   */
  reason: HandoffReason = "lead_pediu_humano",
  urgency: HandoffUrgency = "media",
) {
  const sb = supabaseAdmin();
  const { data: lead, error } = await sb
    .from("leads")
    .select("id, phone, push_name, full_name, brief, handoff_attempts, assigned_agent_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) {
    console.error("[handoff] initiate: lead não encontrado", leadId, error?.message);
    return;
  }

  // Continuidade: se o lead já teve corretor atribuído num ciclo anterior
  // (handoff resolvido → Bia retomou → lead re-esquentou), tenta mandar
  // pro mesmo corretor primeiro. Se ele não abrir ponte em 5min, o
  // `escalateHandoff` já cai na rotação normal excluindo ele. Se o
  // corretor anterior estiver inativo (saiu da empresa, etc.), pula
  // direto pra rotação.
  let agent: Agent | null = null;
  if (lead.assigned_agent_id) {
    const prev = await getAgentById(lead.assigned_agent_id);
    if (prev?.active) {
      agent = prev;
      console.log("[handoff] initiate: continuidade com corretor anterior", {
        leadId,
        agentId: prev.id,
      });
    } else if (prev && !prev.active) {
      console.log("[handoff] initiate: corretor anterior inativo, indo pra rotação", {
        leadId,
        prevAgentId: prev.id,
      });
    }
  }
  if (!agent) agent = await nextInRotation();
  if (!agent) {
    console.warn("[handoff] initiate: nenhum corretor ativo");
    return;
  }

  // Handoff iniciado → cancela follow-ups (corretor humano assume).
  cancelFollowUpsForLead(leadId, "handoff_initiated").catch((e) =>
    console.error("[handoff] cancelFollowUps (initiate)", e),
  );

  await notifyAgentAndSchedule({
    agent,
    leadId,
    leadName: lead.full_name || lead.push_name || lead.phone,
    leadPhone: lead.phone,
    brief: lead.brief ?? null,
    reason,
    urgency,
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

  const maxAttempts = await getSettingNumber("handoff_max_attempts", 3);
  if ((lead.handoff_attempts ?? 0) >= maxAttempts) {
    console.warn("[handoff] escalate: máximo de tentativas atingido", leadId);
    await updateLead(leadId, { stage: "handoff_stuck" });
    return;
  }

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
    reason: "escalacao",
    // Escalação por timeout sempre entra como urgência alta — corretor
    // anterior já deixou passar, esse lead tá esfriando rápido.
    urgency: "alta",
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
  reason: HandoffReason;
  urgency: HandoffUrgency | null;
  excludeIds: string[];
  attempts: number;
}) {
  const appBaseUrl = process.env.APP_BASE_URL ?? "https://lumihaus.com.br";
  const text = formatHandoffNotification({
    leadName: args.leadName,
    leadPhone: args.leadPhone,
    reason: HANDOFF_REASON_LABEL[args.reason],
    urgency: args.urgency,
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
      // Novo fire — limpa qualquer review anterior pra reaparecer em "pendente".
      handoff_resolved_at: null,
      handoff_attempts: args.attempts,
      handoff_reason: args.reason,
      handoff_urgency: args.urgency,
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

  await scheduleEscalation(args.leadId, escalateHandoff);
  console.log("[handoff] escalation scheduled for", args.leadId);
}

export async function openBridge(leadId: string, agentId: string) {
  await cancelEscalation(leadId);
  cancelFollowUpsForLead(leadId, "bridge_opened").catch((e) =>
    console.error("[handoff] cancelFollowUps (openBridge)", e),
  );
  await updateLead(leadId, {
    bridge_active: true,
    assigned_agent_id: agentId,
    bridge_closed_at: null,
  } as Record<string, unknown>);
  await markAssigned(agentId, leadId);
}

export async function closeBridge(leadId: string) {
  await cancelEscalation(leadId);
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("leads")
    .select("assigned_agent_id")
    .eq("id", leadId)
    .maybeSingle();
  if (data?.assigned_agent_id) {
    await clearCurrentLead(data.assigned_agent_id);
  }
  // Devolve atendimento pra Bia. Lead é da empresa — não pode ficar
  // trancado em corretor que deu /fim (que pode ter saído da empresa
  // depois). Se re-esquentar, Bia re-escala (preferindo o mesmo agent
  // via continuidade, mas caindo pra rotação se ele não responder em 5min).
  //
  // Reset `handoff_attempts=0`: contador é por CICLO de handoff, não pela
  // vida do lead. Se a bridge fechou, o ciclo terminou e o próximo
  // handoff deve poder usar todas as N tentativas de novo. Sem isso,
  // leads longevos batem em handoff_max_attempts logo no primeiro retry
  // de qualquer ciclo futuro e caem em handoff_stuck. A guarda contra
  // loop continua valendo dentro de UM ciclo (initiate→escalate→...).
  await updateLead(leadId, {
    bridge_active: false,
    bridge_closed_at: new Date().toISOString(),
    human_takeover: false,
    handoff_attempts: 0,
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
