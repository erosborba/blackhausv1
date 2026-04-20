import { supabaseAdmin } from "./supabase";

/**
 * Registro de drafts propostos pela Bia no modo copiloto.
 *
 * O ciclo de vida é:
 *   proposed → approved | edited | ignored
 *
 * 'ignored' não é marcado aqui — um cron periódico (futuro) vai varrer
 * drafts 'proposed' com mais de N horas e reclassificar.
 */

export type DraftConfidence = "alta" | "media" | "baixa";
export type DraftAction = "proposed" | "approved" | "edited" | "ignored";

export type DraftRow = {
  id: string;
  lead_id: string;
  agent_id: string | null;
  proposed_text: string;
  confidence: DraftConfidence;
  action: DraftAction;
  final_text: string | null;
  created_at: string;
  acted_at: string | null;
};

export async function recordDraft(args: {
  leadId: string;
  agentId: string | null;
  proposedText: string;
  confidence: DraftConfidence;
}): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("drafts")
    .insert({
      lead_id: args.leadId,
      agent_id: args.agentId,
      proposed_text: args.proposedText,
      confidence: args.confidence,
      action: "proposed",
    })
    .select("id")
    .single();
  if (error) {
    // Não é crítico — logar e seguir. O draft ainda é entregue ao corretor,
    // só não vai pro banco de métricas.
    console.error("[drafts] recordDraft failed:", error.message);
    return null;
  }
  return data.id as string;
}

/**
 * Busca o draft 'proposed' mais recente pra este par (lead, agent).
 *
 * Uso: quando o corretor faz quote de uma mensagem de draft e responde com
 * 👍 ou edição, precisamos achar a linha pra atualizar action/final_text.
 *
 * Sem draft_id no header da mensagem, dependemos de "último proposto" —
 * funciona bem porque o corretor atua em um draft por vez, e a UX é síncrona
 * (ele responde logo depois de receber).
 */
export async function findLatestProposed(args: {
  leadId: string;
  agentId: string;
}): Promise<DraftRow | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("drafts")
    .select("*")
    .eq("lead_id", args.leadId)
    .eq("agent_id", args.agentId)
    .eq("action", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[drafts] findLatestProposed failed:", error.message);
    return null;
  }
  return (data as DraftRow) ?? null;
}

export async function markDraftActed(args: {
  id: string;
  action: "approved" | "edited";
  finalText: string;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("drafts")
    .update({
      action: args.action,
      final_text: args.finalText,
      acted_at: new Date().toISOString(),
    })
    .eq("id", args.id);
  if (error) {
    console.error("[drafts] markDraftActed failed:", error.message);
  }
}

/**
 * Agregado de métricas — usado por um futuro endpoint de admin.
 * Retorna contagens por (confidence, action) pra calcular taxa de aprovação.
 */
export async function draftMetrics(sinceDays = 30): Promise<
  Array<{ confidence: DraftConfidence; action: DraftAction; count: number }>
> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("drafts")
    .select("confidence, action")
    .gte("created_at", since);
  if (error) {
    console.error("[drafts] draftMetrics failed:", error.message);
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ confidence: DraftConfidence; action: DraftAction }>) {
    const k = `${row.confidence}|${row.action}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([k, count]) => {
    const [confidence, action] = k.split("|") as [DraftConfidence, DraftAction];
    return { confidence, action, count };
  });
}
