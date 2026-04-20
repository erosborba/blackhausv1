import { supabaseAdmin } from "./supabase";
import { getSettingNumber } from "./settings";

const ESCALATION_MS_FALLBACK = Number(process.env.HANDOFF_ESCALATION_MS ?? 5 * 60 * 1000);

async function getEscalationMs(): Promise<number> {
  return getSettingNumber("handoff_escalation_ms", ESCALATION_MS_FALLBACK);
}

// Timers em memória — fonte de verdade é o banco, isso é só o executor local
const timers = new Map<string, NodeJS.Timeout>();
let recovered = false; // garante que recoverEscalations só roda uma vez por processo

/**
 * Agenda escalação: persiste no banco E inicia setTimeout.
 * DB sobrevive a restarts; setTimeout executa no processo atual.
 */
export async function scheduleEscalation(
  leadId: string,
  onEscalate: (leadId: string) => Promise<void>,
  delayMs?: number,
): Promise<void> {
  const resolvedDelay = delayMs ?? (await getEscalationMs());
  const sb = supabaseAdmin();
  const scheduledFor = new Date(Date.now() + resolvedDelay).toISOString();

  // Cancela pendente anterior no banco antes de inserir (mantém índice único válido)
  await sb
    .from("handoff_escalations")
    .update({ status: "cancelled" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  const { error } = await sb.from("handoff_escalations").insert({
    lead_id: leadId,
    scheduled_for: scheduledFor,
  });
  if (error) console.error("[handoffQueue] scheduleEscalation db", leadId, error.message);

  // Timer em memória (best-effort para o processo atual)
  _setTimer(leadId, onEscalate, resolvedDelay);
}

/** Cancela escalação no banco e na memória. */
export async function cancelEscalation(leadId: string): Promise<void> {
  _clearTimer(leadId);

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("handoff_escalations")
    .update({ status: "cancelled" })
    .eq("lead_id", leadId)
    .eq("status", "pending");
  if (error) console.error("[handoffQueue] cancelEscalation db", leadId, error.message);
}

export async function hasPendingEscalation(leadId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("handoff_escalations")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .maybeSingle();
  return !!data;
}

/**
 * Restaura timers de escalações pendentes após restart do processo.
 * Chame uma vez ao iniciar (ex.: no webhook handler). Idempotente.
 */
export async function recoverEscalations(
  onEscalate: (leadId: string) => Promise<void>,
): Promise<void> {
  if (recovered) return;
  recovered = true;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("handoff_escalations")
    .select("id, lead_id, scheduled_for")
    .eq("status", "pending");

  if (error) {
    console.error("[handoffQueue] recoverEscalations", error.message);
    return;
  }
  if (!data?.length) return;

  let restored = 0;
  for (const row of data) {
    if (timers.has(row.lead_id as string)) continue; // já tem timer ativo
    const remaining = new Date(row.scheduled_for as string).getTime() - Date.now();
    // Se já venceu, dispara imediatamente (100ms); senão, agenda pelo tempo restante
    _setTimer(row.lead_id as string, onEscalate, Math.max(remaining, 100));
    restored++;
  }

  if (restored > 0) console.log(`[handoffQueue] recovered ${restored} escalation(s) from db`);
}

// --- helpers internos ---

function _setTimer(
  leadId: string,
  onEscalate: (leadId: string) => Promise<void>,
  delayMs: number,
) {
  _clearTimer(leadId);
  const t = setTimeout(async () => {
    timers.delete(leadId);
    // Lock atômico no banco — protege contra corrida se o cron externo existir
    const sb = supabaseAdmin();
    const { data: locked } = await sb
      .from("handoff_escalations")
      .update({ status: "fired" })
      .eq("lead_id", leadId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!locked) return; // já foi processado (ex.: cancelamento chegou tarde)
    try {
      await onEscalate(leadId);
    } catch (e) {
      console.error("[handoffQueue] onEscalate error", leadId, e);
    }
  }, delayMs);
  timers.set(leadId, t);
}

function _clearTimer(leadId: string) {
  const t = timers.get(leadId);
  if (t) {
    clearTimeout(t);
    timers.delete(leadId);
  }
}

/**
 * Processa escalações vencidas via HTTP (usado por cron externo se disponível).
 */
export async function processHandoffEscalations(
  onEscalate: (leadId: string) => Promise<void>,
): Promise<{ fired: number; errors: number }> {
  const sb = supabaseAdmin();
  const { data: due, error } = await sb
    .from("handoff_escalations")
    .select("id, lead_id")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .limit(50);

  if (error) {
    console.error("[handoffQueue] processHandoffEscalations fetch", error.message);
    return { fired: 0, errors: 1 };
  }
  if (!due?.length) return { fired: 0, errors: 0 };

  let fired = 0;
  let errors = 0;
  for (const row of due) {
    const { data: locked } = await sb
      .from("handoff_escalations")
      .update({ status: "fired" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!locked) continue;
    try {
      await onEscalate(row.lead_id as string);
      fired++;
    } catch (e) {
      console.error("[handoffQueue] onEscalate error", row.lead_id, e);
      errors++;
    }
  }
  return { fired, errors };
}
