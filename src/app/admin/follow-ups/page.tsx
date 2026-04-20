import type { CSSProperties } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FollowUpStatus = "pending" | "sent" | "cancelled" | "failed";

type FollowUpRow = {
  id: string;
  lead_id: string;
  step: number;
  scheduled_for: string;
  status: FollowUpStatus;
  message: string | null;
  sent_at: string | null;
  error: string | null;
  cancel_reason: string | null;
  created_at: string;
  leads: { phone: string; push_name: string | null; full_name: string | null } | null;
};

const WINDOW_DAYS = 30;
const RECENT_LIMIT = 60;

async function loadFollowUps(): Promise<FollowUpRow[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("follow_ups")
    .select(
      "id, lead_id, step, scheduled_for, status, message, sent_at, error, cancel_reason, created_at, leads(phone, push_name, full_name)",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) {
    console.error("[admin/follow-ups] load error:", error);
    return [];
  }
  return (data ?? []) as unknown as FollowUpRow[];
}

type Stats = {
  total: number;
  pending: number;
  sent: number;
  cancelled: number;
  failed: number;
  byStep: Record<number, { total: number; sent: number; pending: number; cancelled: number; failed: number }>;
};

function computeStats(rows: FollowUpRow[]): Stats {
  const empty = () => ({ total: 0, pending: 0, sent: 0, cancelled: 0, failed: 0 });
  const stats: Stats = { ...empty(), byStep: {} };
  for (const r of rows) {
    stats.total++;
    stats[r.status]++;
    if (!stats.byStep[r.step]) {
      stats.byStep[r.step] = { total: 0, sent: 0, pending: 0, cancelled: 0, failed: 0 };
    }
    const b = stats.byStep[r.step];
    b.total++;
    b[r.status]++;
  }
  return stats;
}

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
  gridTemplateColumns: "repeat(5, 1fr)",
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
const row: CSSProperties = { padding: "14px 18px", borderBottom: "1px solid #2a2a32" };
const meta: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  fontSize: 12,
  color: "#8f8f9a",
  marginBottom: 8,
  flexWrap: "wrap",
};
const textBlock: CSSProperties = {
  fontSize: 13,
  color: "#e7e7ea",
  whiteSpace: "pre-wrap",
  lineHeight: 1.45,
};
const errorBlock: CSSProperties = {
  fontSize: 12,
  color: "#d96b6b",
  marginTop: 6,
  fontFamily: "ui-monospace, monospace",
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

function statusChip(s: FollowUpStatus) {
  if (s === "sent") return chip("#1e3a2b", "#6bd99b");
  if (s === "pending") return chip("#1e2b3a", "#6b9dd9");
  if (s === "cancelled") return chip("#2a2a32", "#8f8f9a");
  return chip("#3a1e1e", "#d96b6b");
}

function stepChip(step: number) {
  const colors: Record<number, [string, string]> = {
    1: ["#1e2b3a", "#6b9dd9"],
    2: ["#2b2e1e", "#d9cf6b"],
    3: ["#3a2b1e", "#d99b6b"],
  };
  const [bg, fg] = colors[step] ?? ["#2a2a32", "#8f8f9a"];
  return chip(bg, fg);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export default async function FollowUpsPage() {
  const rows = await loadFollowUps();
  const stats = computeStats(rows);
  const steps = Object.keys(stats.byStep)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <main style={container}>
      <div style={headerRow}>
        <div>
          <Link href="/admin/leads" style={backLink}>
            ← Inbox
          </Link>
          <h1 style={{ margin: "6px 0 0", fontSize: 24 }}>Follow-ups</h1>
          <div style={{ color: "#8f8f9a", fontSize: 13, marginTop: 4 }}>
            Últimos {WINDOW_DAYS} dias · {stats.total} registros
          </div>
        </div>
        <Link
          href="/admin/configuracoes"
          style={{ ...backLink, color: "#6b9dd9" }}
        >
          Configurações →
        </Link>
      </div>

      <div style={cardsGrid}>
        <div style={card}>
          <div style={cardLabel}>Total</div>
          <div style={cardValue}>{stats.total}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Enviados</div>
          <div style={{ ...cardValue, color: "#6bd99b" }}>{stats.sent}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Agendados</div>
          <div style={{ ...cardValue, color: "#6b9dd9" }}>{stats.pending}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Cancelados</div>
          <div style={{ ...cardValue, color: "#8f8f9a" }}>{stats.cancelled}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Falhas</div>
          <div style={{ ...cardValue, color: "#d96b6b" }}>{stats.failed}</div>
        </div>
      </div>

      <div style={sectionTitle}>Breakdown por step</div>
      <table style={breakdownTable}>
        <thead>
          <tr>
            <th style={th}>Step</th>
            <th style={{ ...th, textAlign: "right" }}>Total</th>
            <th style={{ ...th, textAlign: "right" }}>Enviados</th>
            <th style={{ ...th, textAlign: "right" }}>Agendados</th>
            <th style={{ ...th, textAlign: "right" }}>Cancelados</th>
            <th style={{ ...th, textAlign: "right" }}>Falhas</th>
          </tr>
        </thead>
        <tbody>
          {steps.length === 0 ? (
            <tr>
              <td style={{ ...td, color: "#8f8f9a" }} colSpan={6}>
                Nenhum follow-up ainda no período.
              </td>
            </tr>
          ) : (
            steps.map((s) => {
              const b = stats.byStep[s];
              return (
                <tr key={s}>
                  <td style={td}>
                    <span style={stepChip(s)}>step {s}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{b.total}</td>
                  <td style={{ ...td, textAlign: "right", color: "#6bd99b" }}>{b.sent}</td>
                  <td style={{ ...td, textAlign: "right", color: "#6b9dd9" }}>{b.pending}</td>
                  <td style={{ ...td, textAlign: "right", color: "#8f8f9a" }}>{b.cancelled}</td>
                  <td style={{ ...td, textAlign: "right", color: "#d96b6b" }}>{b.failed}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div style={sectionTitle}>Últimos registros</div>
      {rows.length === 0 ? (
        <div style={{ ...list, padding: 40, textAlign: "center", color: "#8f8f9a" }}>
          Nenhum follow-up no período.
        </div>
      ) : (
        <div style={list}>
          {rows.map((r) => {
            const leadName = r.leads?.full_name || r.leads?.push_name || r.leads?.phone || "—";
            return (
              <div key={r.id} style={row}>
                <div style={meta}>
                  <span style={statusChip(r.status)}>{r.status}</span>
                  <span style={stepChip(r.step)}>step {r.step}</span>
                  <Link
                    href={`/admin/leads/${r.lead_id}`}
                    style={{ color: "#e7e7ea", textDecoration: "none" }}
                  >
                    {leadName}
                    {r.leads?.phone ? ` · ${r.leads.phone}` : ""}
                  </Link>
                  <span>agendado: {fmtDateTime(r.scheduled_for)}</span>
                  {r.sent_at ? <span>enviado: {fmtDateTime(r.sent_at)}</span> : null}
                  {r.cancel_reason ? <span>motivo: {r.cancel_reason}</span> : null}
                  <span style={{ marginLeft: "auto" }}>{timeAgo(r.created_at)}</span>
                </div>
                {r.message ? <div style={textBlock}>{r.message}</div> : null}
                {r.error ? <div style={errorBlock}>erro: {r.error}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
