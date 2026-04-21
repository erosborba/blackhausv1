import { redirect } from "next/navigation";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import { supabaseAdmin } from "@/lib/supabase";
import type { DraftAction, DraftConfidence } from "@/lib/drafts";
import { SwipeStack, type SwipeCard } from "@/components/mobile/SwipeStack";

export const dynamic = "force-dynamic";

/**
 * /m/decisions — fila de drafts pendentes da Bia em formato "stack".
 * Corretor desliza o card pra direita (aprovar) ou esquerda (ignorar),
 * ou toca nos botões inferiores.
 *
 * Não substitui /revisao (desktop): lá tem breakdown + edição. Aqui é
 * "swipe and move" — intencionalmente otimizado pra decisão rápida.
 */
export default async function MobileDecisionsPage() {
  const role = await getCurrentRole();
  if (!can(role, "revisao.view")) redirect("/m/brief");

  const canApprove = can(role, "revisao.approve");
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("drafts")
    .select(
      "id, lead_id, proposed_text, confidence, created_at, leads(full_name, push_name, phone), agents(name)",
    )
    .eq("action", "proposed")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(30);

  if (error) {
    console.error("[m/decisions] load:", error.message);
  }

  const cards: SwipeCard[] = ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as Record<string, unknown> & { leads?: unknown; agents?: unknown };
    const leadsRaw = r.leads;
    const agentsRaw = r.agents;
    const lead = Array.isArray(leadsRaw) ? leadsRaw[0] : leadsRaw;
    const agent = Array.isArray(agentsRaw) ? agentsRaw[0] : agentsRaw;
    const l = (lead ?? {}) as {
      full_name?: string | null;
      push_name?: string | null;
      phone?: string | null;
    };
    const a = (agent ?? {}) as { name?: string | null };
    return {
      id: String(r.id),
      lead_id: String(r.lead_id),
      leadName: l.full_name || l.push_name || l.phone || "—",
      agentName: a.name ?? null,
      confidence: r.confidence as DraftConfidence,
      action: "proposed" as DraftAction,
      proposed_text: String(r.proposed_text ?? ""),
      created_at: String(r.created_at),
    };
  });

  return (
    <>
      <h1 className="m-page-title">Decisões</h1>
      <p className="m-page-sub">
        {cards.length === 0
          ? "Nenhum draft esperando sua decisão."
          : `${cards.length} draft${cards.length > 1 ? "s" : ""} esperando. ${
              canApprove ? "Deslize pra aprovar (→) ou ignorar (←)." : "Somente admin decide."
            }`}
      </p>

      {cards.length === 0 ? (
        <div className="m-empty" style={{ padding: "60px 20px" }}>
          <div className="m-empty-title">Fila vazia 🎯</div>
          A Bia não tem drafts pendentes nos últimos 7 dias.
        </div>
      ) : (
        <SwipeStack cards={cards} canApprove={canApprove} />
      )}
    </>
  );
}
