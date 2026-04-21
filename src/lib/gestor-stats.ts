import { supabaseAdmin } from "./supabase";
import { getHandoffStats, type HandoffRating } from "./handoff-feedback";
import type { HandoffReason, HandoffUrgency } from "./handoff-copy";

/**
 * Stats agregados do /gestor — KPIs + sparklines + alertas + conversão.
 *
 * Consome leads (últimos N dias) + messages (inner) + handoff_feedback +
 * follow_ups. É a versão "resumo executivo" do legacy /admin/funnel — as
 * tabelas detalhadas ficam embaixo mas o foco são os cards de cima e os
 * alertas operacionais.
 */

export type GestorWindow = 7 | 30 | 90;

export type Spark = number[]; // uma entrada por dia, oldest → newest

export type GestorStats = {
  window_days: number;
  generated_at: string;

  // Cards topo
  total_leads: number;
  won: number;
  handoff_count: number;
  responded_count: number;

  // Taxa de resposta + conversão
  response_rate: number | null; // responderam / criados
  conversion_rate: number | null; // won / qualified
  qualified_count: number;

  // Sparklines (últimos N dias)
  leads_per_day: Spark;
  messages_per_day: Spark;
  handoffs_per_day: Spark;

  // Handoff breakdown
  handoff_by_reason: Array<{ reason: HandoffReason | "sem_motivo"; count: number }>;
  handoff_by_urgency: Array<{ urgency: HandoffUrgency | "sem_urgencia"; count: number }>;

  // Handoff feedback (TECH_DEBT Tier 3 #1)
  handoff_feedback: {
    total: number;
    counts: Record<HandoffRating, number>;
    accuracy: number | null;
  };

  // Alertas operacionais
  alerts: Alert[];

  // Dias com datas reais (pra labels do chart)
  days_labels: string[];
};

export type Alert = {
  kind: "handoff_pending_high" | "follow_ups_overdue" | "hot_leads_stale" | "handoff_accuracy_low";
  severity: "warn" | "hot";
  message: string;
  detail?: string;
};

export async function loadGestorStats(windowDays: GestorWindow = 30): Promise<GestorStats> {
  const sb = supabaseAdmin();
  const now = Date.now();
  const since = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [leadsRes, msgsRes, feedbackStats, fuOverdueRes, inboxRes] =
    await Promise.all([
      sb
        .from("leads")
        .select(
          "id, created_at, status, bridge_active, handoff_notified_at, handoff_reason, handoff_urgency, last_message_at, score",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
      sb
        .from("messages")
        .select("lead_id, direction, created_at")
        .gte("created_at", since)
        .limit(30000),
      getHandoffStats(windowDays),
      sb
        .from("follow_ups")
        .select("lead_id")
        .eq("status", "pending")
        .lte("scheduled_for", new Date().toISOString()),
      sb.rpc("inbox_items", { search_text: null }),
    ]);

  const leads = (leadsRes.data ?? []) as Array<{
    id: string;
    created_at: string;
    status: string;
    bridge_active: boolean | null;
    handoff_notified_at: string | null;
    handoff_reason: HandoffReason | null;
    handoff_urgency: HandoffUrgency | null;
    last_message_at: string | null;
    score: number | null;
  }>;
  const msgs = (msgsRes.data ?? []) as Array<{
    lead_id: string;
    direction: string;
    created_at: string;
  }>;
  const inbox = (inboxRes.data ?? []) as Array<{
    id: string;
    score: number;
    last_message_at: string | null;
    handoff_notified_at: string | null;
    bridge_active: boolean | null;
  }>;

  // Dias buckets
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    days.push(d.toISOString().slice(0, 10));
  }
  const dayIndex = new Map<string, number>(days.map((d, i) => [d, i]));

  const leads_per_day: Spark = Array(windowDays).fill(0);
  const messages_per_day: Spark = Array(windowDays).fill(0);
  const handoffs_per_day: Spark = Array(windowDays).fill(0);

  for (const l of leads) {
    const d = l.created_at.slice(0, 10);
    const i = dayIndex.get(d);
    if (i !== undefined) leads_per_day[i]++;
    if (l.handoff_notified_at) {
      const hd = l.handoff_notified_at.slice(0, 10);
      const hi = dayIndex.get(hd);
      if (hi !== undefined) handoffs_per_day[hi]++;
    }
  }
  for (const m of msgs) {
    const d = m.created_at.slice(0, 10);
    const i = dayIndex.get(d);
    if (i !== undefined) messages_per_day[i]++;
  }

  // Responderam: set de lead_ids com qualquer inbound.
  const respondedSet = new Set<string>();
  for (const m of msgs) if (m.direction === "inbound") respondedSet.add(m.lead_id);
  const responded_count = leads.filter((l) => respondedSet.has(l.id)).length;

  const total_leads = leads.length;
  const won = leads.filter((l) => l.status === "won").length;
  const qualified_count = leads.filter(
    (l) => l.status === "qualified" || l.status === "won",
  ).length;
  const handoff_count = leads.filter((l) => l.handoff_notified_at).length;

  const response_rate = total_leads > 0 ? responded_count / total_leads : null;
  const conversion_rate = qualified_count > 0 ? won / qualified_count : null;

  // Handoff breakdown
  const reasonMap = new Map<string, number>();
  const urgencyMap = new Map<string, number>();
  for (const l of leads) {
    if (!l.handoff_notified_at) continue;
    const r = l.handoff_reason ?? "sem_motivo";
    reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1);
    const u = l.handoff_urgency ?? "sem_urgencia";
    urgencyMap.set(u, (urgencyMap.get(u) ?? 0) + 1);
  }
  const handoff_by_reason = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason: reason as HandoffReason | "sem_motivo", count }))
    .sort((a, b) => b.count - a.count);
  const handoff_by_urgency = Array.from(urgencyMap.entries())
    .map(([urgency, count]) => ({ urgency: urgency as HandoffUrgency | "sem_urgencia", count }))
    .sort((a, b) => b.count - a.count);

  // Alertas ----------------------------------------------------------------
  const alerts: Alert[] = [];
  const pendingHandoff = inbox.filter(
    (r) => r.handoff_notified_at !== null && r.bridge_active !== true,
  ).length;
  if (pendingHandoff >= 5) {
    alerts.push({
      kind: "handoff_pending_high",
      severity: pendingHandoff >= 10 ? "hot" : "warn",
      message: `${pendingHandoff} handoffs pendentes na fila`,
      detail: "corretor ainda não abriu a ponte",
    });
  }

  const overdueFu = (fuOverdueRes.data ?? []).length;
  if (overdueFu >= 3) {
    alerts.push({
      kind: "follow_ups_overdue",
      severity: overdueFu >= 10 ? "hot" : "warn",
      message: `${overdueFu} follow-ups devidos`,
      detail: "vão disparar no próximo tick do cron",
    });
  }

  const hotStale = inbox.filter((r) => {
    if ((r.score ?? 0) < 80) return false;
    if (!r.last_message_at) return false;
    const ageH = (now - new Date(r.last_message_at).getTime()) / 3_600_000;
    return ageH >= 4;
  }).length;
  if (hotStale >= 1) {
    alerts.push({
      kind: "hot_leads_stale",
      severity: hotStale >= 5 ? "hot" : "warn",
      message: `${hotStale} lead${hotStale > 1 ? "s" : ""} quente${hotStale > 1 ? "s" : ""} sem resposta há 4h+`,
      detail: "score ≥ 80 e silêncio pós-inbound",
    });
  }

  if (
    feedbackStats.total >= 10 &&
    feedbackStats.accuracy !== null &&
    feedbackStats.accuracy < 0.6
  ) {
    alerts.push({
      kind: "handoff_accuracy_low",
      severity: "warn",
      message: `Acurácia de handoff em ${(feedbackStats.accuracy * 100).toFixed(0)}%`,
      detail: "router pode estar escalando cedo ou tarde — revisar few-shots",
    });
  }

  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    total_leads,
    won,
    handoff_count,
    responded_count,
    response_rate,
    conversion_rate,
    qualified_count,
    leads_per_day,
    messages_per_day,
    handoffs_per_day,
    handoff_by_reason,
    handoff_by_urgency,
    handoff_feedback: feedbackStats,
    alerts,
    days_labels: days,
  };
}
