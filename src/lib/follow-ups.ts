import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import { getSetting, getSettingNumber } from "./settings";
import { sendText } from "./evolution";
import { appendMessage, type Lead, type Qualification } from "./leads";
import { anthropicUsage, logUsage } from "./ai-usage";

/**
 * Sistema de follow-up automático (nurturing).
 *
 * Fluxo:
 *  1. Cron /api/cron/followup-scan (1x/dia) identifica leads elegíveis e
 *     agenda step 1 na tabela follow_ups.
 *  2. Cron /api/cron/followup-send (a cada minuto) processa follow_ups
 *     pending vencidos, respeitando rate limit e janela horária.
 *  3. Quando um follow-up é enviado com sucesso, agenda o próximo step.
 *  4. Qualquer atividade do lead (resposta, bridge, takeover, won/lost)
 *     cancela todos os pending via cancelFollowUpsForLead.
 *
 * Anti-ban WhatsApp:
 *  - followup_rate_per_min: máximo de envios por minuto
 *  - followup_window_start/end: janela horária de envio
 *  - Cada envio inclui delay natural do Evolution API
 *  - Default followup_enabled = false (precisa ativar explicitamente)
 */

const MAX_STEP = 3;
const MESSAGE_MODEL = "claude-haiku-4-5";

export type FollowUpRow = {
  id: string;
  lead_id: string;
  step: number;
  scheduled_for: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  message: string | null;
  sent_at: string | null;
  error: string | null;
  cancel_reason: string | null;
  created_at: string;
};

// ============================================================
// SCHEDULING
// ============================================================

/**
 * Agenda o primeiro follow-up para um lead. Idempotente — se já existe
 * pending ou sent recente, não agenda de novo.
 */
export async function scheduleInitialFollowUp(leadId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const days = await getSettingNumber("followup_step_1_days", 3);
  const scheduledFor = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await sb.from("follow_ups").insert({
    lead_id: leadId,
    step: 1,
    scheduled_for: scheduledFor,
  });

  // 23505 = unique_violation (já tem pending para este lead/step)
  if (error && error.code !== "23505") {
    console.error("[follow-ups] scheduleInitial", leadId, error.message);
    return false;
  }
  return !error;
}

/**
 * Agenda o próximo step após um envio bem-sucedido. Chamado de dentro do
 * send loop. Só agenda se step < MAX_STEP.
 */
async function scheduleNextStep(leadId: string, currentStep: number): Promise<void> {
  if (currentStep >= MAX_STEP) return;

  const sb = supabaseAdmin();
  const nextStep = currentStep + 1;
  const days = await getSettingNumber(`followup_step_${nextStep}_days`, nextStep === 2 ? 7 : 14);
  const scheduledFor = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await sb.from("follow_ups").insert({
    lead_id: leadId,
    step: nextStep,
    scheduled_for: scheduledFor,
  });
  if (error && error.code !== "23505") {
    console.error("[follow-ups] scheduleNextStep", leadId, nextStep, error.message);
  }
}

/**
 * Cancela todos os follow-ups pending de um lead. Usado quando o lead
 * responde, bridge abre, takeover, etc.
 */
export async function cancelFollowUpsForLead(leadId: string, reason: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("follow_ups")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("lead_id", leadId)
    .eq("status", "pending");
  if (error) console.error("[follow-ups] cancel", leadId, error.message);
}

// ============================================================
// SCAN — encontra leads elegíveis e agenda step 1
// ============================================================

/**
 * Identifica leads que não falam com a Bia há N dias e agenda follow-up 1.
 *
 * Critérios de elegibilidade (conservadores):
 *  - lead.status NOT IN ('won', 'lost', 'new')
 *  - lead.human_takeover = false
 *  - lead.bridge_active = false
 *  - lead.last_message_at >= N days ago
 *  - total de mensagens >= followup_min_msgs_lead (evita cold lead)
 *  - nenhum follow_up nos últimos 30 dias
 */
export async function scanAndScheduleFollowUps(): Promise<{
  scanned: number;
  scheduled: number;
  skipped: number;
}> {
  const enabled = (await getSetting("followup_enabled", "false")) === "true";
  if (!enabled) return { scanned: 0, scheduled: 0, skipped: 0 };

  const sb = supabaseAdmin();
  const daysIdle = await getSettingNumber("followup_step_1_days", 3);
  const minMsgs = await getSettingNumber("followup_min_msgs_lead", 3);

  const cutoff = new Date(Date.now() - daysIdle * 24 * 60 * 60 * 1000).toISOString();
  // Evita re-scheduling: pula leads com qualquer follow_up nos últimos 30 dias
  const recentFollowUpCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await sb
    .from("leads")
    .select("id, phone, status, stage, last_message_at, human_takeover, bridge_active")
    .not("status", "in", "(won,lost,new)")
    .eq("human_takeover", false)
    .eq("bridge_active", false)
    .lte("last_message_at", cutoff)
    .limit(200);

  if (error) {
    console.error("[follow-ups] scan", error.message);
    return { scanned: 0, scheduled: 0, skipped: 0 };
  }

  if (!candidates?.length) return { scanned: 0, scheduled: 0, skipped: 0 };

  let scheduled = 0;
  let skipped = 0;

  for (const lead of candidates) {
    // Já tem follow-up recente? pula
    const { count: recentCount } = await sb
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead.id)
      .gte("created_at", recentFollowUpCutoff);

    if ((recentCount ?? 0) > 0) {
      skipped++;
      continue;
    }

    // Mensagens suficientes?
    const { count: msgCount } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    if ((msgCount ?? 0) < minMsgs) {
      skipped++;
      continue;
    }

    const ok = await scheduleInitialFollowUp(lead.id);
    if (ok) scheduled++;
    else skipped++;
  }

  return { scanned: candidates.length, scheduled, skipped };
}

// ============================================================
// SEND — processa pending vencidos respeitando rate limit + window
// ============================================================

function isWithinWindow(start: number, end: number): boolean {
  // Horário de Curitiba (BRT = UTC-3)
  const now = new Date();
  const utcHours = now.getUTCHours();
  const localHours = (utcHours - 3 + 24) % 24;
  return localHours >= start && localHours < end;
}

/**
 * Processa follow-ups pending vencidos, respeitando rate/min e janela horária.
 * Cada envio gera mensagem com Haiku a partir da memória + qualificação do lead.
 */
export async function processDueFollowUps(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  reason?: string;
}> {
  const enabled = (await getSetting("followup_enabled", "false")) === "true";
  if (!enabled) return { sent: 0, skipped: 0, failed: 0, reason: "disabled" };

  const windowStart = await getSettingNumber("followup_window_start", 9);
  const windowEnd = await getSettingNumber("followup_window_end", 20);

  if (!isWithinWindow(windowStart, windowEnd)) {
    return { sent: 0, skipped: 0, failed: 0, reason: "out_of_window" };
  }

  const ratePerMin = await getSettingNumber("followup_rate_per_min", 3);

  const sb = supabaseAdmin();
  const { data: due, error } = await sb
    .from("follow_ups")
    .select("id, lead_id, step")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(ratePerMin);

  if (error) {
    console.error("[follow-ups] processDue fetch", error.message);
    return { sent: 0, skipped: 0, failed: 1 };
  }
  if (!due?.length) return { sent: 0, skipped: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const row of due) {
    // Lock atômico
    const { data: locked } = await sb
      .from("follow_ups")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!locked) continue;

    try {
      await sendOne(row.id, row.lead_id, row.step);
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[follow-ups] sendOne failed", row.lead_id, row.step, msg);
      await sb
        .from("follow_ups")
        .update({ status: "failed", error: msg, sent_at: null })
        .eq("id", row.id);
      failed++;
    }
  }

  return { sent, skipped: 0, failed };
}

async function sendOne(followUpId: string, leadId: string, step: number): Promise<void> {
  const sb = supabaseAdmin();

  // Re-verifica elegibilidade (lead pode ter mudado entre scan e send)
  const { data: lead } = await sb
    .from("leads")
    .select("id, phone, push_name, full_name, status, qualification, memory, human_takeover, bridge_active")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) throw new Error("lead not found");
  if (lead.human_takeover || lead.bridge_active) {
    await cancelFollowUpsForLead(leadId, "takeover_or_bridge_at_send");
    throw new Error("lead em takeover/bridge — cancelado");
  }
  if (["won", "lost"].includes(lead.status)) {
    await cancelFollowUpsForLead(leadId, `status_${lead.status}`);
    throw new Error(`lead status=${lead.status} — cancelado`);
  }

  // Lead respondeu depois do scheduled_for? cancela (guard extra)
  const { data: lastInbound } = await sb
    .from("messages")
    .select("created_at")
    .eq("lead_id", leadId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: fu } = await sb
    .from("follow_ups")
    .select("created_at")
    .eq("id", followUpId)
    .maybeSingle();

  if (lastInbound && fu && new Date(lastInbound.created_at) > new Date(fu.created_at)) {
    await cancelFollowUpsForLead(leadId, "lead_responded_before_send");
    throw new Error("lead respondeu após agendamento");
  }

  // Gera mensagem com Haiku
  const message = await generateMessage(lead as Lead, step);

  // Envia via Evolution
  await sendText({ to: lead.phone, text: message, delayMs: 1200 });

  // Persiste conversa + atualiza follow_up com o texto
  await appendMessage({
    leadId,
    direction: "outbound",
    role: "assistant",
    content: message,
  });

  await sb
    .from("follow_ups")
    .update({ message })
    .eq("id", followUpId);

  // Agenda próximo step
  await scheduleNextStep(leadId, step);
}

// ============================================================
// MESSAGE GENERATION
// ============================================================

const SYSTEM_FOLLOWUP = `Você é a Bia, SDR da imobiliária Blackhaus, escrevendo uma mensagem de follow-up via WhatsApp para um lead que não respondeu há alguns dias.

Regras:
- Tom humano, respeitoso, SEM parecer robô ou spam.
- 1 a 3 frases no total. Curto.
- Nunca pressione. Nunca use urgência falsa.
- Reconheça o tempo que passou ("passei por aqui pra saber", "pensei em você") sem soar melodramático.
- Faça UMA pergunta aberta OU ofereça UMA opção concreta de próximo passo.
- Use o nome do lead se disponível.
- Português do Brasil natural de WhatsApp. Emoji com muita parcimônia (0-1).
- NÃO invente preços, empreendimentos ou prazos que não estejam no contexto.

Adapte o tom ao step:
- Step 1 (primeiro toque): leve, curioso, amigável.
- Step 2 (reforço): pergunta específica sobre o que travou ou oferece ajuda.
- Step 3 (última chamada): reconhece que pode não ser o momento, oferece ficar à disposição sem cobrar.

Retorne SOMENTE o texto da mensagem, sem aspas, sem prefixo, sem explicação.`;

async function generateMessage(lead: Lead, step: number): Promise<string> {
  const name = lead.full_name || lead.push_name || "";
  const q = (lead.qualification ?? {}) as Qualification;

  const qualSummary = [
    q.tipo ? `tipo: ${q.tipo}` : null,
    q.quartos ? `${q.quartos}Q` : null,
    q.bairros?.length ? `bairros: ${q.bairros.join(", ")}` : q.cidade ? `cidade: ${q.cidade}` : null,
    q.faixa_preco_max ? `até R$ ${q.faixa_preco_max.toLocaleString("pt-BR")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const userBlock = [
    `Step: ${step} de ${MAX_STEP}`,
    name ? `Nome: ${name}` : "Nome: (não informado)",
    qualSummary ? `Qualificação: ${qualSummary}` : "Qualificação: (incompleta)",
    "",
    "Memória do lead (contexto da última conversa):",
    lead.memory?.trim() || "(sem memória persistente ainda)",
    "",
    "Escreva a mensagem de follow-up agora.",
  ].join("\n");

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();

  try {
    const resp = await anthropic.messages.create({
      model: MESSAGE_MODEL,
      max_tokens: 300,
      system: SYSTEM_FOLLOWUP,
      messages: [{ role: "user", content: userBlock }],
    });

    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();

    logUsage({
      provider: "anthropic",
      model: MESSAGE_MODEL,
      task: "followup_message",
      ...anthropicUsage(resp),
      durationMs: Date.now() - t0,
      leadId: lead.id,
      ok: true,
    });

    if (!text) throw new Error("resposta vazia do Haiku");
    return text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logUsage({
      provider: "anthropic",
      model: MESSAGE_MODEL,
      task: "followup_message",
      durationMs: Date.now() - t0,
      leadId: lead.id,
      ok: false,
      error: msg,
    });
    throw e;
  }
}
