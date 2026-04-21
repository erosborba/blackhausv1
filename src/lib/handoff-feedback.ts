import { supabaseAdmin } from "./supabase";

/**
 * Handoff feedback — sinal pós-escalação que o corretor/gestor deixa
 * pra dizer se a Bia acertou o momento.
 *
 * Feed de:
 *   (a) /gestor → acurácia de handoff (últimos 30d)
 *   (b) eval loop → few-shots pro router decidir melhor quando escalar
 *   (c) pipeline → lead_ruim some das métricas de conversão
 *
 * Uma linha por avaliação (histórico conservado). A UI mostra o último.
 */

export type HandoffRating = "bom" | "cedo" | "tarde" | "lead_ruim";

export const HANDOFF_RATINGS: HandoffRating[] = ["bom", "cedo", "tarde", "lead_ruim"];

export const HANDOFF_RATING_LABEL: Record<HandoffRating, string> = {
  bom: "Foi bom",
  cedo: "Cedo demais",
  tarde: "Tarde demais",
  lead_ruim: "Lead ruim",
};

export const HANDOFF_RATING_HINT: Record<HandoffRating, string> = {
  bom: "Na hora certa, lead quente.",
  cedo: "Devia ter qualificado mais antes de escalar.",
  tarde: "Segurou demais, lead já esfriou.",
  lead_ruim: "Não era problema da Bia — sem fit.",
};

export const HANDOFF_RATING_EMOJI: Record<HandoffRating, string> = {
  bom: "🎯",
  cedo: "⏩",
  tarde: "⏪",
  lead_ruim: "🗑️",
};

export type HandoffFeedbackRow = {
  id: string;
  lead_id: string;
  rating: HandoffRating;
  note: string | null;
  actor: string | null;
  at: string;
};

/**
 * Grava feedback. Nunca UPSERT — conservamos histórico. A UI lê sempre
 * o mais recente via `getLatestFeedback`.
 */
export async function recordHandoffFeedback(args: {
  leadId: string;
  rating: HandoffRating;
  note?: string | null;
  actor?: string | null;
}): Promise<HandoffFeedbackRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("handoff_feedback")
    .insert({
      lead_id: args.leadId,
      rating: args.rating,
      note: args.note ?? null,
      actor: args.actor ?? null,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[handoff-feedback] record failed:", error.message);
    return null;
  }
  return data as HandoffFeedbackRow;
}

export async function getLatestFeedback(
  leadId: string,
): Promise<HandoffFeedbackRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("handoff_feedback")
    .select("*")
    .eq("lead_id", leadId)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[handoff-feedback] getLatest failed:", error.message);
    return null;
  }
  return (data as HandoffFeedbackRow) ?? null;
}

export async function listFeedback(
  leadId: string,
): Promise<HandoffFeedbackRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("handoff_feedback")
    .select("*")
    .eq("lead_id", leadId)
    .order("at", { ascending: false });
  if (error) {
    console.error("[handoff-feedback] list failed:", error.message);
    return [];
  }
  return (data ?? []) as HandoffFeedbackRow[];
}

/**
 * Stats agregados (últimos N dias). Usado no /gestor pra mostrar
 * "acurácia de handoff".
 *
 * Acurácia = 'bom' / total avaliados. 'lead_ruim' é excluído do denominador
 * porque não é falha de timing do router — é falha de input.
 */
export async function getHandoffStats(sinceDays = 30): Promise<{
  total: number;
  counts: Record<HandoffRating, number>;
  accuracy: number | null; // null se denominador = 0
}> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("handoff_feedback_stats", {
    p_since_days: sinceDays,
  });
  if (error) {
    console.error("[handoff-feedback] stats failed:", error.message);
    return { total: 0, counts: emptyCounts(), accuracy: null };
  }
  const rows = (data ?? []) as Array<{
    rating: HandoffRating;
    count: number;
    lead_count: number;
  }>;
  const counts = emptyCounts();
  for (const r of rows) {
    if (HANDOFF_RATINGS.includes(r.rating)) counts[r.rating] = Number(r.count);
  }
  const total = counts.bom + counts.cedo + counts.tarde + counts.lead_ruim;
  const denom = counts.bom + counts.cedo + counts.tarde; // exclui lead_ruim
  const accuracy = denom > 0 ? counts.bom / denom : null;
  return { total, counts, accuracy };
}

function emptyCounts(): Record<HandoffRating, number> {
  return { bom: 0, cedo: 0, tarde: 0, lead_ruim: 0 };
}
