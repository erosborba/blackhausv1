/**
 * Helpers pra `agent_availability` (Track 2 · Slice 2.9).
 *
 * O slot-allocator lê as janelas de disponibilidade via Supabase direto.
 * Aqui ficam leituras agregadas (por agente) pra UI do editor e uma
 * fachada mínima de CRUD.
 *
 * Contrato da tabela:
 *   agent_id uuid
 *   weekday smallint 0..6 (0 = domingo, 6 = sábado — segue padrão ISO/JS)
 *   start_minute, end_minute int (0..1440)
 *   timezone text default 'America/Sao_Paulo'
 *   active boolean default true
 *
 * Unique index: (agent_id, weekday, start_minute, end_minute) WHERE active.
 */
import { supabaseAdmin } from "./supabase";

export type AgentAvailabilityRow = {
  id: string;
  agent_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
  active: boolean;
  created_at: string;
};

export type AgentWithAvailability = {
  agent_id: string;
  agent_name: string;
  agent_phone: string;
  active: boolean;
  windows: AgentAvailabilityRow[];
};

/** Lista todos os corretores (ativos) + suas janelas de disponibilidade. */
export async function listAgentsWithAvailability(): Promise<AgentWithAvailability[]> {
  const sb = supabaseAdmin();
  const { data: agents, error: ea } = await sb
    .from("agents")
    .select("id, name, phone, active")
    .order("name", { ascending: true });
  if (ea) {
    console.error("[agent-availability] list agents:", ea.message);
    return [];
  }
  const agentIds = (agents ?? []).map((a) => (a as { id: string }).id);
  if (agentIds.length === 0) return [];

  const { data: wins, error: ew } = await sb
    .from("agent_availability")
    .select("*")
    .in("agent_id", agentIds)
    .eq("active", true)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });
  if (ew) {
    console.error("[agent-availability] list windows:", ew.message);
  }
  const byAgent = new Map<string, AgentAvailabilityRow[]>();
  for (const w of (wins ?? []) as AgentAvailabilityRow[]) {
    if (!byAgent.has(w.agent_id)) byAgent.set(w.agent_id, []);
    byAgent.get(w.agent_id)!.push(w);
  }

  return (agents ?? []).map((a) => {
    const row = a as { id: string; name: string; phone: string; active: boolean };
    return {
      agent_id: row.id,
      agent_name: row.name,
      agent_phone: row.phone,
      active: row.active,
      windows: byAgent.get(row.id) ?? [],
    };
  });
}

export type CreateAvailabilityInput = {
  agent_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  timezone?: string;
};

export async function createAvailabilityWindow(
  input: CreateAvailabilityInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  // Validação básica — evita gravar lixo mesmo se a UI passar algo torto.
  if (input.weekday < 0 || input.weekday > 6) {
    return { ok: false, error: "weekday deve estar entre 0 e 6" };
  }
  if (
    input.start_minute < 0 ||
    input.start_minute >= 1440 ||
    input.end_minute <= 0 ||
    input.end_minute > 1440
  ) {
    return { ok: false, error: "minutos devem estar em [0, 1440]" };
  }
  if (input.end_minute <= input.start_minute) {
    return { ok: false, error: "fim precisa ser maior que início" };
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("agent_availability")
    .insert({
      agent_id: input.agent_id,
      weekday: input.weekday,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      timezone: input.timezone ?? "America/Sao_Paulo",
      active: true,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // 23505 = unique violation — janela já existe, UX OK, trata como sucesso.
    if (error.code === "23505") return { ok: true };
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string } | null)?.id };
}

export async function deactivateAvailabilityWindow(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("agent_availability")
    .update({ active: false })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─── agent_unavailability (bloqueios pontuais — Slice 2.3') ─────────────

export type AgentUnavailabilityRow = {
  id: string;
  agent_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

/**
 * Busca bloqueios ativos que podem afetar uma janela de tempo. Retorna
 * no formato `BusyVisit` (com duration_min) pro slot-allocator consumir
 * direto.
 *
 * `from`/`to` são usados pra narrow no índice — passe o horizonte do
 * allocator (default 7 dias).
 */
export async function fetchUnavailabilityAsBusy(args: {
  agent_ids?: string[];
  from: Date;
  to: Date;
}): Promise<
  Array<{ agent_id: string; scheduled_at: string; duration_min: number }>
> {
  const sb = supabaseAdmin();
  let q = sb
    .from("agent_unavailability")
    .select("agent_id, start_at, end_at")
    .eq("active", true)
    .lt("start_at", args.to.toISOString())
    .gt("end_at", args.from.toISOString());
  if (args.agent_ids && args.agent_ids.length > 0) {
    q = q.in("agent_id", args.agent_ids);
  }
  const { data, error } = await q;
  if (error) {
    console.error("[agent-unavailability] fetch:", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as { agent_id: string; start_at: string; end_at: string };
    const durMin = Math.max(
      1,
      Math.round(
        (new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000,
      ),
    );
    return {
      agent_id: row.agent_id,
      scheduled_at: row.start_at,
      duration_min: durMin,
    };
  });
}

export async function listUnavailability(agentId?: string): Promise<AgentUnavailabilityRow[]> {
  const sb = supabaseAdmin();
  let q = sb
    .from("agent_unavailability")
    .select("*")
    .eq("active", true)
    .gte("end_at", new Date().toISOString()) // só futuros / em curso
    .order("start_at", { ascending: true });
  if (agentId) q = q.eq("agent_id", agentId);
  const { data, error } = await q;
  if (error) {
    console.error("[agent-unavailability] list:", error.message);
    return [];
  }
  return (data ?? []) as AgentUnavailabilityRow[];
}

export type CreateUnavailabilityInput = {
  agent_id: string;
  start_at: string; // ISO
  end_at: string;
  reason?: string | null;
  created_by?: string | null;
};

export async function createUnavailability(
  input: CreateUnavailabilityInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const start = new Date(input.start_at);
  const end = new Date(input.end_at);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, error: "datas inválidas" };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: "fim precisa ser maior que início" };
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("agent_unavailability")
    .insert({
      agent_id: input.agent_id,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      reason: input.reason ?? null,
      created_by: input.created_by ?? "admin",
      active: true,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string } | null)?.id };
}

export async function deactivateUnavailability(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("agent_unavailability")
    .update({ active: false })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
