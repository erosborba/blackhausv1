import { supabaseAdmin } from "./supabase";

/**
 * Panorama do dia — agregações rápidas pra /brief.
 *
 * Não usa LLM: consulta direto o banco. O brief narrativo por lead
 * continua em `generateBrief(leadId)` e é invocado sob demanda no card.
 *
 * Calculado em runtime (page é force-dynamic). Cachear só vale se a
 * base crescer — por enquanto 200 leads = query de ms.
 */

export type PanoramaKPI = {
  novos_hoje: number;
  handoff_pendente: number;
  follow_ups_devidos: number;
  leads_quentes: number; // score >= 80
  total_ativos: number;
};

export type ActionItem = {
  id: string;
  name: string;
  phone: string;
  stage: string | null;
  status: string;
  score: number;
  last_message_at: string | null;
  last_message_snippet: string | null;
  handoff_pending: boolean;
  handoff_reason: string | null;
  handoff_urgency: "alta" | "media" | "baixa" | null;
  priority_kind: "handoff" | "hot" | "follow_up" | "new";
};

export async function getPanorama(): Promise<{
  kpi: PanoramaKPI;
  actions: ActionItem[];
}> {
  const sb = supabaseAdmin();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Puxa inbox_items direto — já vem ordenado por urgency × score.
  const { data: inbox, error } = await sb.rpc("inbox_items", {
    search_text: null,
  });
  if (error) {
    console.error("[brief-panorama] inbox_items:", error.message);
    return { kpi: emptyKpi(), actions: [] };
  }

  const rows = (inbox ?? []) as Array<{
    id: string;
    phone: string;
    push_name: string | null;
    full_name: string | null;
    status: string;
    stage: string | null;
    score: number;
    last_message_at: string | null;
    last_message_content: string | null;
    handoff_notified_at: string | null;
    handoff_resolved_at: string | null;
    handoff_reason: string | null;
    handoff_urgency: "alta" | "media" | "baixa" | null;
    bridge_active: boolean | null;
  }>;

  // Follow-ups devidos — status=pending + scheduled_for no passado.
  const { data: fuDue } = await sb
    .from("follow_ups")
    .select("lead_id")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString());
  const followUpLeadIds = new Set((fuDue ?? []).map((r) => r.lead_id as string));

  // KPIs --------------------------------------------------------------------
  const novos_hoje = rows.filter(
    (r) => r.last_message_at && r.last_message_at >= since24h && r.status === "new",
  ).length;

  const handoff_pendente = rows.filter(
    (r) =>
      r.handoff_notified_at !== null &&
      r.bridge_active !== true &&
      !r.handoff_resolved_at,
  ).length;

  const leads_quentes = rows.filter((r) => (r.score ?? 0) >= 80).length;
  const total_ativos = rows.filter(
    (r) => r.status !== "won" && r.status !== "lost",
  ).length;

  const kpi: PanoramaKPI = {
    novos_hoje,
    handoff_pendente,
    follow_ups_devidos: followUpLeadIds.size,
    leads_quentes,
    total_ativos,
  };

  // Action items — top 10 com classificação de prioridade.
  const classified = rows
    .map((r): ActionItem & { _rank: number } => {
      const pending =
        r.handoff_notified_at !== null &&
        r.bridge_active !== true &&
        !r.handoff_resolved_at;
      const isHot = (r.score ?? 0) >= 80;
      const isFu = followUpLeadIds.has(r.id);
      const isNew =
        r.status === "new" &&
        r.last_message_at !== null &&
        r.last_message_at >= since24h;

      let kind: ActionItem["priority_kind"] = "new";
      let rank = 0;
      if (pending && r.handoff_urgency === "alta") {
        kind = "handoff";
        rank = 100;
      } else if (pending) {
        kind = "handoff";
        rank = 80;
      } else if (isHot) {
        kind = "hot";
        rank = 70;
      } else if (isFu) {
        kind = "follow_up";
        rank = 60;
      } else if (isNew) {
        kind = "new";
        rank = 30;
      } else {
        rank = Math.min(25, r.score ?? 0);
      }

      return {
        id: r.id,
        name: r.full_name || r.push_name || r.phone,
        phone: r.phone,
        stage: r.stage,
        status: r.status,
        score: r.score ?? 0,
        last_message_at: r.last_message_at,
        last_message_snippet: r.last_message_content
          ? r.last_message_content.slice(0, 120)
          : null,
        handoff_pending: pending,
        handoff_reason: r.handoff_reason,
        handoff_urgency: r.handoff_urgency,
        priority_kind: kind,
        _rank: rank,
      };
    })
    .filter((r) => r._rank > 0)
    .sort((a, b) => b._rank - a._rank || b.score - a.score);

  const actions = classified.slice(0, 10).map(({ _rank: _r, ...rest }) => rest);

  return { kpi, actions };
}

function emptyKpi(): PanoramaKPI {
  return {
    novos_hoje: 0,
    handoff_pendente: 0,
    follow_ups_devidos: 0,
    leads_quentes: 0,
    total_ativos: 0,
  };
}
