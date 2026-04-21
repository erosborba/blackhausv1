import { supabaseAdmin } from "./supabase";
import { emitLeadEvent } from "./lead-events";

/**
 * Domínio do kanban /pipeline. Stages vivem em `leads.stage` (texto livre,
 * mas a Bia só emite os 6 valores canônicos abaixo — ver agent/state.ts).
 * Leads terminais (won/lost) ficam fora do kanban principal.
 *
 * Move é manual (corretor arrasta card) — emite `stage_change` no
 * lead_events pra timeline manter rastro.
 */

export type PipelineStage =
  | "greet"
  | "discover"
  | "qualify"
  | "recommend"
  | "schedule"
  | "handoff";

export const PIPELINE_STAGES: PipelineStage[] = [
  "greet",
  "discover",
  "qualify",
  "recommend",
  "schedule",
  "handoff",
];

export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  greet: "Saudação",
  discover: "Descoberta",
  qualify: "Qualificação",
  recommend: "Recomendação",
  schedule: "Agendamento",
  handoff: "Handoff",
};

export const PIPELINE_STAGE_HINT: Record<PipelineStage, string> = {
  greet: "Chegou agora — primeiro contato",
  discover: "Explorando necessidade",
  qualify: "Coletando fit (quartos, faixa, prazo)",
  recommend: "Apresentando empreendimentos",
  schedule: "Marcando visita",
  handoff: "Com corretor humano",
};

export type PipelineCount = {
  stage: string; // pode ser '—' (leads sem stage)
  count: number;
};

export type PipelineLead = {
  id: string;
  phone: string;
  name: string | null;
  score: number;
  status: string;
  last_message_at: string | null;
  handoff_notified_at: string | null;
};

// ============================================================
// READS
// ============================================================

export async function getPipelineCounts(): Promise<PipelineCount[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("pipeline_counts");
  if (error) {
    console.error("[pipeline] counts:", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ stage: string; count: number | string }>).map((r) => ({
    stage: r.stage,
    count: Number(r.count),
  }));
}

export async function getPipelineLeads(stage: string, limit = 50): Promise<PipelineLead[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("pipeline_leads", {
    p_stage: stage,
    p_limit: limit,
  });
  if (error) {
    console.error("[pipeline] leads:", error.message);
    return [];
  }
  return ((data ?? []) as PipelineLead[]).map((r) => ({
    ...r,
    score: Number(r.score ?? 0),
  }));
}

/**
 * Vista consolidada do board — todas as colunas já populadas. Uma chamada
 * por coluna; paralelo. Pra boards pequenos (< 500 leads ativos) isso é
 * rápido o bastante e evita paginação complexa.
 */
export async function getPipelineBoard(limitPerStage = 50): Promise<{
  counts: PipelineCount[];
  byStage: Record<string, PipelineLead[]>;
}> {
  const counts = await getPipelineCounts();
  const entries = await Promise.all(
    counts.map(async (c) => [c.stage, await getPipelineLeads(c.stage, limitPerStage)] as const),
  );
  const byStage: Record<string, PipelineLead[]> = {};
  for (const [stage, leads] of entries) byStage[stage] = leads;
  return { counts, byStage };
}

// ============================================================
// WRITES
// ============================================================

/**
 * Move um lead pra outra stage. Emite `stage_change` no lead_events com
 * o ator (quem arrastou o card). Sem guard de transição — o kanban confia
 * no corretor; a Bia pode sobrescrever no próximo turno se achar errado.
 *
 * Retorna `{ from, to }` com o valor anterior pra UI poder fazer undo.
 */
export async function moveLeadStage(
  leadId: string,
  toStage: string,
  actor?: string | null,
): Promise<{ ok: true; from: string | null; to: string } | { ok: false; error: string }> {
  const sb = supabaseAdmin();

  const { data: before, error: readErr } = await sb
    .from("leads")
    .select("stage")
    .eq("id", leadId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!before) return { ok: false, error: "lead não encontrado" };

  const fromStage = (before as { stage: string | null }).stage ?? null;
  if (fromStage === toStage) {
    return { ok: true, from: fromStage, to: toStage };
  }

  const { error: updErr } = await sb.from("leads").update({ stage: toStage }).eq("id", leadId);
  if (updErr) return { ok: false, error: updErr.message };

  void emitLeadEvent({
    leadId,
    kind: "stage_change",
    payload: { from: fromStage, to: toStage, source: "manual" },
    actor: actor ?? "gestor",
  });

  return { ok: true, from: fromStage, to: toStage };
}
