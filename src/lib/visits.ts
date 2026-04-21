import { supabaseAdmin } from "./supabase";
import { emitLeadEvent } from "./lead-events";

/**
 * Domínio de visitas (agendamentos entre lead e corretor num empreendimento).
 *
 * Status transita linearmente:
 *   scheduled → confirmed → done    (happy path)
 *   scheduled → cancelled           (lead ou corretor cancelou)
 *   scheduled → no_show             (lead faltou — sinal ruim pra funil)
 *
 * Um lead pode ter várias visits (remarcações, múltiplos empreendimentos).
 * A pista de auditoria fica em `created_by` ("bia" | "corretor:<id>" | "lead")
 * + lead_events emitido em cada mutação relevante.
 */

export type VisitStatus = "scheduled" | "confirmed" | "done" | "cancelled" | "no_show";

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  done: "Realizada",
  cancelled: "Cancelada",
  no_show: "Não compareceu",
};

export const VISIT_STATUS_TONE: Record<VisitStatus, "default" | "ok" | "warn" | "hot" | "ghost"> = {
  scheduled: "default",
  confirmed: "ok",
  done: "ghost",
  cancelled: "ghost",
  no_show: "hot",
};

export type Visit = {
  id: string;
  lead_id: string;
  agent_id: string | null;
  empreendimento_id: string | null;
  unidade_id: string | null;
  scheduled_at: string;
  status: VisitStatus;
  notes: string | null;
  created_by: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type VisitWithContext = {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  empreendimento_id: string | null;
  empreendimento_nome: string | null;
  agent_id: string | null;
  scheduled_at: string;
  status: VisitStatus;
  notes: string | null;
};

// ============================================================
// READS
// ============================================================

/**
 * Visitas num intervalo [from, to). RPC faz join com leads + empreendimentos
 * pra /agenda não precisar fazer N+1 client-side.
 */
export async function listVisitsBetween(
  from: Date,
  to: Date,
): Promise<VisitWithContext[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("visits_between", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) {
    console.error("[visits] between:", error.message);
    return [];
  }
  return (data ?? []) as VisitWithContext[];
}

export async function listVisitsForLead(leadId: string): Promise<Visit[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("visits")
    .select("*")
    .eq("lead_id", leadId)
    .order("scheduled_at", { ascending: false });
  if (error) {
    console.error("[visits] listForLead:", error.message);
    return [];
  }
  return (data ?? []) as Visit[];
}

export async function getVisit(id: string): Promise<Visit | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("visits").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[visits] get:", error.message);
    return null;
  }
  return (data as Visit | null) ?? null;
}

/**
 * Visitas de hoje (timezone America/Sao_Paulo) — shortcut pro /agenda default.
 * "Hoje" = janela [00:00, 23:59:59] no horário BR. Convertemos pra UTC pro filtro.
 */
export async function listVisitsToday(): Promise<VisitWithContext[]> {
  const { from, to } = dayBoundsBR(new Date());
  return listVisitsBetween(from, to);
}

export function dayBoundsBR(reference: Date): { from: Date; to: Date } {
  // Offset fixo BRT (-03:00). Suficiente pra o que precisamos — não vale
  // carregar Intl.DateTimeFormat pra isso.
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = reference.toLocaleString("en-US", { year: "numeric", timeZone: "America/Sao_Paulo" });
  const mm = pad(Number(reference.toLocaleString("en-US", { month: "numeric", timeZone: "America/Sao_Paulo" })));
  const dd = pad(Number(reference.toLocaleString("en-US", { day: "numeric", timeZone: "America/Sao_Paulo" })));
  const from = new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
  const to = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999-03:00`);
  return { from, to };
}

// ============================================================
// WRITES
// ============================================================

export type CreateVisitInput = {
  lead_id: string;
  agent_id?: string | null;
  empreendimento_id?: string | null;
  unidade_id?: string | null;
  scheduled_at: string; // ISO
  notes?: string | null;
  created_by?: string | null;
};

/**
 * Agenda nova visita. Emite lead_event pra timeline do lead. Retorna row
 * criada ou null em caso de erro (caller decide se propaga).
 */
export async function createVisit(input: CreateVisitInput): Promise<Visit | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("visits")
    .insert({
      lead_id: input.lead_id,
      agent_id: input.agent_id ?? null,
      empreendimento_id: input.empreendimento_id ?? null,
      unidade_id: input.unidade_id ?? null,
      scheduled_at: input.scheduled_at,
      notes: input.notes ?? null,
      created_by: input.created_by ?? null,
      status: "scheduled",
    })
    .select("*")
    .single();
  if (error) {
    console.error("[visits] create:", error.message);
    return null;
  }
  const visit = data as Visit;
  void emitLeadEvent({
    leadId: visit.lead_id,
    kind: "note_added",
    payload: {
      sub: "visit_scheduled",
      visit_id: visit.id,
      empreendimento_id: visit.empreendimento_id,
      scheduled_at: visit.scheduled_at,
    },
    actor: visit.created_by ?? "system",
  });
  return visit;
}

export async function updateVisitStatus(
  id: string,
  status: VisitStatus,
  extra?: { notes?: string | null; cancelled_reason?: string | null; actor?: string | null },
): Promise<boolean> {
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = { status };
  if (extra?.notes !== undefined) patch.notes = extra.notes;
  if (extra?.cancelled_reason !== undefined) patch.cancelled_reason = extra.cancelled_reason;
  const { data, error } = await sb
    .from("visits")
    .update(patch)
    .eq("id", id)
    .select("lead_id")
    .single();
  if (error) {
    console.error("[visits] updateStatus:", error.message);
    return false;
  }
  void emitLeadEvent({
    leadId: (data as { lead_id: string }).lead_id,
    kind: "note_added",
    payload: {
      sub: "visit_status",
      visit_id: id,
      status,
      reason: extra?.cancelled_reason ?? null,
    },
    actor: extra?.actor ?? "system",
  });
  return true;
}

export async function rescheduleVisit(
  id: string,
  scheduledAt: string,
  actor?: string | null,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("visits")
    .update({ scheduled_at: scheduledAt, status: "scheduled" })
    .eq("id", id)
    .select("lead_id")
    .single();
  if (error) {
    console.error("[visits] reschedule:", error.message);
    return false;
  }
  void emitLeadEvent({
    leadId: (data as { lead_id: string }).lead_id,
    kind: "note_added",
    payload: { sub: "visit_rescheduled", visit_id: id, scheduled_at: scheduledAt },
    actor: actor ?? "system",
  });
  return true;
}
