import type { CSSProperties } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import type { DraftAction, DraftConfidence } from "@/lib/drafts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dashboard de drafts: mede quanto a Bia acerta o tom quando propõe resposta
 * no modo copiloto. A ideia é validar que `confiança = alta` realmente bate
 * ~95% de aprovação antes de liberar auto-send (Fase 3B).
 */

type DraftWithRefs = {
  id: string;
  lead_id: string;
  agent_id: string | null;
  proposed_text: string;
  confidence: DraftConfidence;
  action: DraftAction;
  final_text: string | null;
  created_at: string;
  acted_at: string | null;
  leads: { phone: string; push_name: string | null; full_name: string | null } | null;
  agents: { name: string } | null;
};

const WINDOW_DAYS = 30;
const RECENT_LIMIT = 40;

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
    console.error("[admin/drafts] load error:", error);
    return [];
  }
  return (data ?? []) as unknown as DraftWithRefs[];
}

type Stats = {
  total: number;
  approved: number;
  edited: number;
  proposed: number;
  ignored: number;
  byConfidence: Record<
    DraftConfidence,
    { total: number; approved: number; edited: number; proposed: number; ignored: number }
  >;
};

function computeStats(rows: DraftWithRefs[]): Stats {
  const empty = () => ({ total: 0, approved: 0, edited: 0, proposed: 0, ignored: 0 });
  const stats: Stats = {
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

/** Taxa "aprovada sem edição" — o número que importa pra liberar auto-send. */
function approvalPct(bucket: { total: number; approved: number }): number | null {
  if (bucket.total === 0) return null;
  return Math.round((bucket.approved / bucket.total) * 100);
}

// ── Estilos (inline, estilo do resto do admin) ──
const container: CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "32px 20px" };
const headerRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 20,
};
const backLink: CSSProperties = { color: "#8f8f9a", textDecoration: "none", fontSize: 13 };
const cardsGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 12,
  marginBottom: 28,
};
const card: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  padding: "16px 18px",
};
const cardLabel: CSSProperties = {
  color: "#8f8f9a",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 6,
};
const cardValue: CSSProperties = { fontSize: 28, fontWeight: 600 };
const cardHint: CSSProperties = { color: "#8f8f9a", fontSize: 12, marginTop: 4 };
const sectionTitle: CSSProperties = {
  fontSize: 13,
  color: "#8f8f9a",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "0 0 10px 2px",
};
const breakdownTable: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
  marginBottom: 28,
};
const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8f8f9a",
  borderBottom: "1px solid #2a2a32",
  fontWeight: 500,
};
const td: CSSProperties = { padding: "10px 14px", fontSize: 14, borderBottom: "1px solid #1f1f26" };
const list: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
};
const draftRow: CSSProperties = { padding: "14px 18px", borderBottom: "1px solid #2a2a32" };
const draftMeta: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  fontSize: 12,
  color: "#8f8f9a",
  marginBottom: 8,
};
const textBlock: CSSProperties = {
  fontSize: 13,
  color: "#e7e7ea",
  whiteSpace: "pre-wrap",
  lineHeight: 1.45,
};
const editedBlock: CSSProperties = {
  fontSize: 13,
  color: "#d9cf6b",
  whiteSpace: "pre-wrap",
  lineHeight: 1.45,
  marginTop: 8,
  paddingLeft: 10,
  borderLeft: "2px solid #3a3720",
};

const chip = (bg: string, fg: string): CSSProperties => ({
  background: bg,
  color: fg,
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  display: "inline-block",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 500,
});

function confidenceChip(c: DraftConfidence) {
  if (c === "alta") return chip("#1e3a2b", "#6bd99b");
  if (c === "media") return chip("#2b2e1e", "#d9cf6b");
  return chip("#3a1e1e", "#d96b6b");
}

function actionChip(a: DraftAction) {
  switch (a) {
    case "approved":
      return chip("#1e3a2b", "#6bd99b");
    case "edited":
      return chip("#2b2e1e", "#d9cf6b");
    case "ignored":
      return chip("#2a2a32", "#8f8f9a");
    default:
      return chip("#1e2b3a", "#6b9dd9"); // proposed
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

export default async function DraftsPage() {
  const drafts = await loadDrafts();
  const stats = computeStats(drafts);
  const overallPct = approvalPct(stats);
  const altaPct = approvalPct(stats.byConfidence.alta);
  const mediaPct = approvalPct(stats.byConfidence.media);

  return (
    <main style={container}>
      <div style={headerRow}>
        <div>
          <Link href="/admin/leads" style={backLink}>
            ← Inbox
          </Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Drafts</h1>
          <div style={{ color: "#8f8f9a", fontSize: 13, marginTop: 4 }}>
            Últimos {WINDOW_DAYS} dias · {stats.total} propostas
          </div>
        </div>
      </div>

      {/* Cards de overview */}
      <div style={cardsGrid}>
        <div style={card}>
          <div style={cardLabel}>Total propostas</div>
          <div style={cardValue}>{stats.total}</div>
          <div style={cardHint}>
            {stats.approved} aprovados · {stats.edited} editados · {stats.proposed} pendentes
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Aprovação geral</div>
          <div style={cardValue}>{overallPct == null ? "—" : `${overallPct}%`}</div>
          <div style={cardHint}>sem nenhuma edição do corretor</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>🟢 Alta</div>
          <div style={cardValue}>{altaPct == null ? "—" : `${altaPct}%`}</div>
          <div style={cardHint}>
            {stats.byConfidence.alta.approved}/{stats.byConfidence.alta.total} aprovadas
            {altaPct != null && altaPct >= 90 ? " · pronta pra auto-send" : ""}
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>🟡 Média</div>
          <div style={cardValue}>{mediaPct == null ? "—" : `${mediaPct}%`}</div>
          <div style={cardHint}>
            {stats.byConfidence.media.approved}/{stats.byConfidence.media.total} aprovadas
          </div>
        </div>
      </div>

      {/* Breakdown por confiança */}
      <div style={sectionTitle}>Breakdown por confiança</div>
      <table style={breakdownTable}>
        <thead>
          <tr>
            <th style={th}>Confiança</th>
            <th style={{ ...th, textAlign: "right" }}>Total</th>
            <th style={{ ...th, textAlign: "right" }}>Aprovadas</th>
            <th style={{ ...th, textAlign: "right" }}>Editadas</th>
            <th style={{ ...th, textAlign: "right" }}>Pendentes</th>
            <th style={{ ...th, textAlign: "right" }}>Taxa de aprovação</th>
          </tr>
        </thead>
        <tbody>
          {(["alta", "media", "baixa"] as DraftConfidence[]).map((c) => {
            const b = stats.byConfidence[c];
            const pct = approvalPct(b);
            return (
              <tr key={c}>
                <td style={td}>
                  <span style={confidenceChip(c)}>{c}</span>
                </td>
                <td style={{ ...td, textAlign: "right" }}>{b.total}</td>
                <td style={{ ...td, textAlign: "right", color: "#6bd99b" }}>{b.approved}</td>
                <td style={{ ...td, textAlign: "right", color: "#d9cf6b" }}>{b.edited}</td>
                <td style={{ ...td, textAlign: "right", color: "#8f8f9a" }}>{b.proposed}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                  {pct == null ? "—" : `${pct}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Lista de drafts recentes */}
      <div style={sectionTitle}>Últimas propostas</div>
      {drafts.length === 0 ? (
        <div style={{ ...list, padding: 40, textAlign: "center", color: "#8f8f9a" }}>
          Nenhum draft no período.
        </div>
      ) : (
        <div style={list}>
          {drafts.map((d) => {
            const leadName = d.leads?.full_name || d.leads?.push_name || d.leads?.phone || "—";
            const wasEdited = d.action === "edited" && d.final_text && d.final_text !== d.proposed_text;
            return (
              <div key={d.id} style={draftRow}>
                <div style={draftMeta}>
                  <span style={actionChip(d.action)}>{d.action}</span>
                  <span style={confidenceChip(d.confidence)}>{d.confidence}</span>
                  <span>
                    {leadName}
                    {d.leads?.phone ? ` · ${d.leads.phone}` : ""}
                  </span>
                  {d.agents?.name ? <span>· {d.agents.name}</span> : null}
                  <span style={{ marginLeft: "auto" }}>{timeAgo(d.created_at)}</span>
                </div>
                <div style={textBlock}>{d.proposed_text}</div>
                {wasEdited ? (
                  <div style={editedBlock}>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#8f8f9a",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 4,
                      }}
                    >
                      Editado pelo corretor:
                    </div>
                    {d.final_text}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
