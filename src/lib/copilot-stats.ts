/**
 * Vanguard · Track 3 · Slice 3.6a — telemetria do copilot.
 *
 * Expõe métricas agregadas do `copilot_suggestions` pra o /ajustes saber
 * se a Bia tá acertando em modo copilot. As três razões que importam:
 *
 *   - sent-without-edit / total-sent: quão bem a Bia escreve. Se alto,
 *     corretor confia; se baixo, texto da tool precisa revisar.
 *   - sent / (sent + discarded): taxa de aproveitamento. Se baixa, ou
 *     a Bia tá sugerindo na hora errada, ou os números da tool estão
 *     furando confiança do corretor.
 *   - discarded_reasons: distribuição de motivos pra priorizar correção.
 *
 * Tudo é "últimos N dias" — 7 é o default razoável pra produto novo.
 * Sugestões `pending` ficam fora dos denominadores (ainda não resolveram).
 *
 * Invariants:
 *   - I-4: puro SELECT agregado. Não muta nada.
 *   - Resiliente: erro em query → retorna shape com zeros + warning;
 *     caller desenha estado "sem dados" sem crashar.
 */
import { supabaseAdmin } from "./supabase";

export type CopilotSuggestionStats = {
  /** Janela aplicada (dias). Espelha input pra caller renderizar "últimos X dias". */
  daysBack: number;
  /** Total de sugestões criadas na janela (pending + sent + discarded). */
  total: number;
  /** Pending = ainda não resolveu (corretor não olhou ou não decidiu). */
  pending: number;
  /** Enviadas com/sem edição. `sentEdited` ⊆ `sent`. */
  sent: number;
  sentEdited: number;
  /** Descartadas. */
  discarded: number;
  /**
   * sent / (sent + discarded). Null quando denominador = 0 (caller
   * mostra "—" em vez de 0%, que seria enganoso).
   */
  useRate: number | null;
  /**
   * (sent - sentEdited) / sent. Null quando sent = 0. Mede "Bia escreve
   * o texto final quase pronto".
   */
  noEditRate: number | null;
  /**
   * Top motivos de descarte. Free-form em 3.6a; em 3.6b vira enum.
   * Agrupa por string exata — acumulador bobo mas útil pra bootstrap.
   */
  topDiscardReasons: Array<{ reason: string; count: number }>;
};

const EMPTY_STATS = (daysBack: number): CopilotSuggestionStats => ({
  daysBack,
  total: 0,
  pending: 0,
  sent: 0,
  sentEdited: 0,
  discarded: 0,
  useRate: null,
  noEditRate: null,
  topDiscardReasons: [],
});

/**
 * Agrega sugestões das últimas `daysBack` dias (default 7). Lê com
 * supabase-admin, ignora RLS — chamada é server-only (rota autenticada
 * em /ajustes usa getSession antes de chamar).
 */
export async function getSuggestionStats(
  daysBack = 7,
): Promise<CopilotSuggestionStats> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("copilot_suggestions")
    .select("status, edited_text, discarded_reason")
    .gte("created_at", since);

  if (error || !data) {
    console.error("[copilot-stats] query failed:", error?.message);
    return EMPTY_STATS(daysBack);
  }

  let pending = 0;
  let sent = 0;
  let sentEdited = 0;
  let discarded = 0;
  const reasonCounts = new Map<string, number>();

  for (const row of data as Array<{
    status: string;
    edited_text: string | null;
    discarded_reason: string | null;
  }>) {
    if (row.status === "pending") {
      pending++;
    } else if (row.status === "sent") {
      sent++;
      if (row.edited_text !== null) sentEdited++;
    } else if (row.status === "discarded") {
      discarded++;
      const key = (row.discarded_reason ?? "(sem motivo)").trim() || "(sem motivo)";
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  const resolvedDenom = sent + discarded;
  const useRate = resolvedDenom === 0 ? null : sent / resolvedDenom;
  const noEditRate = sent === 0 ? null : (sent - sentEdited) / sent;

  const topDiscardReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    daysBack,
    total: pending + sent + discarded,
    pending,
    sent,
    sentEdited,
    discarded,
    useRate,
    noEditRate,
    topDiscardReasons,
  };
}
