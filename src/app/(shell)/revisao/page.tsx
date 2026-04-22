import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import type { DraftAction, DraftConfidence } from "@/lib/drafts";
import type { DraftWithRefs, RevisaoStats } from "@/components/revisao/types";
import { RevisaoShell } from "./RevisaoShell";
import "./revisao.css";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const RECENT_LIMIT = 60;

type TabKey = "overview" | "pendentes" | "aprendizado";

export default async function RevisaoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const role = await getCurrentRole();
  if (!can(role, "revisao.view")) redirect("/brief");

  const sp = await searchParams;
  const initialTab: TabKey =
    sp?.tab === "pendentes" || sp?.tab === "aprendizado" ? sp.tab : "overview";

  const drafts = await loadDrafts();
  const stats = computeStats(drafts);
  const canApprove = can(role, "revisao.approve");

  return (
    <RevisaoShell
      initialTab={initialTab}
      drafts={drafts}
      stats={stats}
      canApprove={canApprove}
    />
  );
}

async function loadDrafts(): Promise<DraftWithRefs[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("drafts")
    .select(
      "id, lead_id, agent_id, proposed_text, confidence, action, final_text, created_at, acted_at, leads(phone, push_name, full_name), agents(name)",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) {
    console.error("[revisao] loadDrafts:", error.message);
    return [];
  }
  return normalizeDrafts((data ?? []) as unknown[]);
}

function normalizeDrafts(rows: unknown[]): DraftWithRefs[] {
  return rows.map((raw) => {
    const r = raw as Record<string, unknown> & { leads?: unknown; agents?: unknown };
    const leadsRaw = r.leads;
    const agentsRaw = r.agents;
    const lead = Array.isArray(leadsRaw) ? (leadsRaw[0] ?? null) : (leadsRaw ?? null);
    const agent = Array.isArray(agentsRaw) ? (agentsRaw[0] ?? null) : (agentsRaw ?? null);
    return {
      id: String(r.id),
      lead_id: String(r.lead_id),
      agent_id: (r.agent_id as string | null) ?? null,
      proposed_text: String(r.proposed_text ?? ""),
      confidence: r.confidence as DraftConfidence,
      action: r.action as DraftAction,
      final_text: (r.final_text as string | null) ?? null,
      created_at: String(r.created_at),
      acted_at: (r.acted_at as string | null) ?? null,
      leads: lead ? (lead as DraftWithRefs["leads"]) : null,
      agents: agent ? (agent as DraftWithRefs["agents"]) : null,
    };
  });
}

function computeStats(rows: DraftWithRefs[]): RevisaoStats {
  const empty = () => ({ total: 0, approved: 0, edited: 0, proposed: 0, ignored: 0 });
  const stats: RevisaoStats = {
    ...empty(),
    byConfidence: { alta: empty(), media: empty(), baixa: empty() },
  };
  for (const r of rows) {
    stats.total++;
    stats[r.action]++;
    const b = stats.byConfidence[r.confidence];
    b.total++;
    b[r.action]++;
  }
  return stats;
}
