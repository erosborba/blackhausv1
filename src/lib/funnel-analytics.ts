import { supabaseAdmin } from "./supabase";

/**
 * Funil analítico — Track 1 · Slice 1.4.
 *
 * Lê do RPC `pipeline_conversion_funnel` (migration
 * 20260421000004). Lógica do funil vive no Postgres pra garantir que
 * qualquer dashboard/relatório/cron use a mesma fonte da verdade.
 *
 * Invariants: I-2 (exclui test), I-7 (audit-based).
 */

export type FunnelStage = {
  stage: string;
  stage_order: number;
  entered: number;
  exited_to_next: number;
  dropped: number;
  median_time_in_stage_h: number | null;
  p90_time_in_stage_h: number | null;
};

export type FunnelSummary = {
  sinceDays: number;
  stages: FunnelStage[];
  /** Conversão total: leads que chegaram no último stage / entraram no primeiro. */
  overallConversionRate: number | null;
};

export async function fetchFunnel(sinceDays = 30): Promise<FunnelSummary> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("pipeline_conversion_funnel", {
    since_days: sinceDays,
  });
  if (error) throw new Error(error.message);

  const stages = ((data ?? []) as unknown as FunnelStage[])
    .slice()
    .sort((a, b) => a.stage_order - b.stage_order);

  const first = stages[0];
  const last = stages[stages.length - 1];
  const overallConversionRate =
    first && first.entered > 0 && last
      ? last.entered / first.entered
      : null;

  return { sinceDays, stages, overallConversionRate };
}

export function formatHours(h: number | null): string {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Label humano pra cada stage canônico. */
export const STAGE_LABEL: Record<string, string> = {
  greet: "Saudação",
  discover: "Descoberta",
  qualify: "Qualificação",
  recommend: "Recomendação",
  schedule: "Agendamento",
  handoff: "Handoff",
};
