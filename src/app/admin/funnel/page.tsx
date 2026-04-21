import type { CSSProperties } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dashboard de funil (/admin/funnel).
 *
 * Agrega leads + mensagens em memória pra visualizar:
 *  - Volume de leads criados no período + distribuição por dia.
 *  - Conversão entre estágios (new → qualifying → qualified → won).
 *  - Handoff (% atingiu, tempo até handoff, bridges abertas/fechadas).
 *  - Engajamento (distribuição de mensagens por lead).
 *  - Onde travam (idade do last_message_at por estágio).
 *
 * Não cria tabela nova — consome leads + messages que já existem. Custo
 * típico: 2 queries (cap 2000 leads + contagem de mensagens agregada).
 * Se o catálogo crescer muito (>5k leads/período), migrar pra RPC materializada.
 *
 * Pensado pra ler ao vivo, mesmo padrão do /admin/usage (SSR, inline styles).
 */

const WINDOW_DAYS = 30;
const MAX_LEADS = 2000;

type LeadRow = {
  id: string;
  created_at: string;
  updated_at: string | null;
  last_message_at: string | null;
  status: string;
  stage: string | null;
  bridge_active: boolean | null;
  bridge_closed_at: string | null;
  handoff_notified_at: string | null;
  handoff_reason: string | null;
  handoff_urgency: string | null;
  human_takeover: boolean | null;
  assigned_agent_id: string | null;
};

// Copy canônica — duplicada de @/agent/state pra não arrastar import
// server-only desnecessário pra uma página SSR. Manter sincronizado.
const HANDOFF_REASON_LABEL: Record<string, string> = {
  lead_pediu_humano: "pediu humano",
  fora_de_escopo: "fora de escopo",
  objecao_complexa: "objeção complexa",
  ia_incerta: "IA incerta",
  urgencia_alta: "urgência alta",
  escalacao: "escalação",
  outro: "outro",
};

const HANDOFF_REASON_ORDER = [
  "lead_pediu_humano",
  "fora_de_escopo",
  "objecao_complexa",
  "ia_incerta",
  "urgencia_alta",
  "escalacao",
  "outro",
] as const;

const URGENCY_ORDER = ["alta", "media", "baixa"] as const;
const URGENCY_COLOR: Record<string, string> = {
  alta: "#d96b6b",
  media: "#d9cf6b",
  baixa: "#6bd99b",
};

type MsgAgg = {
  lead_id: string;
  total: number;
  inbound: number;
  outbound: number;
  first_at: string;
  last_at: string;
};

// Ordens canônicas pra funnel + engajamento.
const STATUS_ORDER = ["new", "qualifying", "qualified", "won", "lost"] as const;
const STAGE_ORDER = [
  "greet",
  "discover",
  "qualify",
  "recommend",
  "schedule",
  "handoff",
] as const;

async function loadLeads(days: number): Promise<LeadRow[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("leads")
    .select(
      "id, created_at, updated_at, last_message_at, status, stage, bridge_active, bridge_closed_at, handoff_notified_at, handoff_reason, handoff_urgency, human_takeover, assigned_agent_id",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_LEADS);
  if (error) {
    console.error("[admin/funnel] loadLeads", error);
    return [];
  }
  return (data ?? []) as unknown as LeadRow[];
}

/**
 * Agrega mensagens por lead_id em JS (Supabase não suporta GROUP BY via client).
 * Pede só o mínimo (direction + created_at) e filtra pelos leads do período.
 * Cap agressivo: 20k mensagens = ~20 msgs por lead, suficiente pra estatísticas.
 */
async function loadMsgAgg(leadIds: string[]): Promise<Map<string, MsgAgg>> {
  const out = new Map<string, MsgAgg>();
  if (leadIds.length === 0) return out;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("messages")
    .select("lead_id, direction, created_at")
    .in("lead_id", leadIds)
    .limit(20000);
  if (error) {
    console.error("[admin/funnel] loadMsgAgg", error);
    return out;
  }

  for (const m of (data ?? []) as Array<{
    lead_id: string;
    direction: string;
    created_at: string;
  }>) {
    const agg = out.get(m.lead_id) ?? {
      lead_id: m.lead_id,
      total: 0,
      inbound: 0,
      outbound: 0,
      first_at: m.created_at,
      last_at: m.created_at,
    };
    agg.total += 1;
    if (m.direction === "inbound") agg.inbound += 1;
    else if (m.direction === "outbound") agg.outbound += 1;
    if (m.created_at < agg.first_at) agg.first_at = m.created_at;
    if (m.created_at > agg.last_at) agg.last_at = m.created_at;
    out.set(m.lead_id, agg);
  }
  return out;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatPct(num: number, den: number): string {
  if (den <= 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)}min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1)}h`;
  const d = hr / 24;
  return `${d.toFixed(1)}d`;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Estilos (inline, alinhado com /admin/usage) ──
const container: CSSProperties = { maxWidth: 1200, margin: "0 auto", padding: "32px 20px" };
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
  margin: "28px 0 10px 2px",
};
const sectionHelp: CSSProperties = {
  color: "#8f8f9a",
  fontSize: 12,
  margin: "0 0 10px 2px",
};
const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
};
const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8f8f9a",
  borderBottom: "1px solid #2a2a32",
  background: "#121217",
};
const td: CSSProperties = {
  padding: "10px 14px",
  fontSize: 13,
  borderBottom: "1px solid #20202a",
  verticalAlign: "top",
};
const tdRight: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const badge: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  background: "#1f1f27",
  color: "#c5c5d0",
  border: "1px solid #2a2a32",
};

// Barra horizontal pra representar proporção sem depender de lib de gráfico.
function bar(pct: number, color = "#3a6bd9"): CSSProperties {
  return {
    display: "inline-block",
    height: 6,
    width: `${Math.max(0, Math.min(100, pct))}%`,
    background: color,
    borderRadius: 3,
    verticalAlign: "middle",
  };
}

export default async function FunnelPage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await props.searchParams;
  const daysRaw = Number(sp?.days ?? WINDOW_DAYS);
  const days = Math.max(1, Math.min(180, Number.isFinite(daysRaw) ? daysRaw : WINDOW_DAYS));

  const leads = await loadLeads(days);
  const msgAgg = await loadMsgAgg(leads.map((l) => l.id));

  // ── Cards topo: totais ──
  const totalLeads = leads.length;
  const totalMsgs = Array.from(msgAgg.values()).reduce((a, m) => a + m.total, 0);
  const totalHandoff = leads.filter((l) => Boolean(l.handoff_notified_at)).length;
  const totalWon = leads.filter((l) => l.status === "won").length;

  // ── Funnel por status ──
  const byStatus = new Map<string, number>();
  for (const l of leads) {
    byStatus.set(l.status, (byStatus.get(l.status) ?? 0) + 1);
  }
  const statusRows = [...STATUS_ORDER, ...[...byStatus.keys()].filter((s) => !STATUS_ORDER.includes(s as never))]
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .map((status) => ({
      status,
      count: byStatus.get(status) ?? 0,
    }));

  // Conversão sequencial: (qualifying+qualified+won+lost) / total, etc.
  // A ideia é ver "quantos dos que entraram (new) avançaram pra qualifying",
  // "quantos dos qualifying viraram qualified", etc. Como status é terminal
  // pro lead atual, usamos lógica de "pelo menos atingiu esse estágio":
  //   atingiuQualifying = !new    (ou seja, qualquer um exceto new)
  //   atingiuQualified  = qualified | won
  //   atingiuWon        = won
  // Não é perfeito (lost pode ter sido qualified antes), mas é o que temos
  // sem event sourcing.
  const atingiuNew = totalLeads;
  const atingiuQualifying = leads.filter((l) => l.status !== "new").length;
  const atingiuQualified = leads.filter(
    (l) => l.status === "qualified" || l.status === "won",
  ).length;
  const atingiuWon = totalWon;
  const funnelSteps = [
    { label: "Entrou (new)", count: atingiuNew, prev: atingiuNew },
    { label: "Avançou de new", count: atingiuQualifying, prev: atingiuNew },
    { label: "Chegou a qualified/won", count: atingiuQualified, prev: atingiuQualifying },
    { label: "Fechou (won)", count: atingiuWon, prev: atingiuQualified },
  ];

  // ── Handoff ──
  const withHandoff = leads.filter((l) => l.handoff_notified_at);
  const bridgesOpen = leads.filter((l) => l.bridge_active).length;
  const bridgesClosed = leads.filter(
    (l) => !l.bridge_active && Boolean(l.bridge_closed_at),
  ).length;
  // Tempo lead.created_at → handoff_notified_at (mediano).
  const handoffTimes = withHandoff
    .map((l) => new Date(l.handoff_notified_at!).getTime() - new Date(l.created_at).getTime())
    .filter((n) => n > 0);
  const medianHandoffMs = median(handoffTimes);

  // ── Handoff breakdown: motivo + urgência ──
  // Agregamos apenas entre leads que de fato atingiram handoff (handoff_notified_at
  // preenchido). Motivos/urgências ficam null nos leads antigos pré-migration —
  // caímos em "sem motivo" / "sem urgência" nesse caso.
  const handoffByReason = new Map<string, number>();
  const handoffByUrgency = new Map<string, number>();
  for (const l of withHandoff) {
    const r = l.handoff_reason ?? "sem_motivo";
    handoffByReason.set(r, (handoffByReason.get(r) ?? 0) + 1);
    const u = l.handoff_urgency ?? "sem_urgencia";
    handoffByUrgency.set(u, (handoffByUrgency.get(u) ?? 0) + 1);
  }
  const reasonRows = [
    ...HANDOFF_REASON_ORDER,
    ...[...handoffByReason.keys()].filter(
      (r) => !HANDOFF_REASON_ORDER.includes(r as never),
    ),
  ]
    .filter((r, i, arr) => arr.indexOf(r) === i)
    .map((reason) => ({
      reason,
      label: HANDOFF_REASON_LABEL[reason] ?? reason.replace(/_/g, " "),
      count: handoffByReason.get(reason) ?? 0,
    }))
    .filter((r) => r.count > 0);
  const urgencyRows = [
    ...URGENCY_ORDER,
    ...[...handoffByUrgency.keys()].filter((u) => !URGENCY_ORDER.includes(u as never)),
  ]
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .map((urgency) => ({
      urgency,
      count: handoffByUrgency.get(urgency) ?? 0,
    }))
    .filter((u) => u.count > 0);

  // ── Engajamento: distribuição de mensagens por lead ──
  const engagementBuckets = [
    { label: "0 msgs (nunca respondeu)", min: 0, max: 0, count: 0 },
    { label: "1–3", min: 1, max: 3, count: 0 },
    { label: "4–10", min: 4, max: 10, count: 0 },
    { label: "11–30", min: 11, max: 30, count: 0 },
    { label: "31+", min: 31, max: Infinity, count: 0 },
  ];
  let leadsWithAnyInbound = 0;
  for (const l of leads) {
    const agg = msgAgg.get(l.id);
    const n = agg?.total ?? 0;
    if (agg && agg.inbound > 0) leadsWithAnyInbound++;
    for (const b of engagementBuckets) {
      if (n >= b.min && n <= b.max) {
        b.count++;
        break;
      }
    }
  }

  // ── Onde travam: idade do last_message_at por stage atual ──
  // Pra cada stage, conta leads + idade média/mediana do last_message_at.
  const byStage = new Map<
    string,
    { count: number; ages: number[]; leadsWithNoReply: number }
  >();
  const now = Date.now();
  for (const l of leads) {
    if (["won", "lost"].includes(l.status)) continue; // só abertos interessam
    const key = l.stage ?? "—";
    const slot = byStage.get(key) ?? { count: 0, ages: [], leadsWithNoReply: 0 };
    slot.count += 1;
    if (l.last_message_at) {
      slot.ages.push(now - new Date(l.last_message_at).getTime());
    }
    const agg = msgAgg.get(l.id);
    if (!agg || agg.inbound === 0) slot.leadsWithNoReply += 1;
    byStage.set(key, slot);
  }
  const stageRows = [
    ...STAGE_ORDER,
    ...[...byStage.keys()].filter((s) => !STAGE_ORDER.includes(s as never)),
  ]
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .map((stage) => {
      const slot = byStage.get(stage);
      const count = slot?.count ?? 0;
      const medAge = slot ? median(slot.ages) : 0;
      const stuck = slot?.leadsWithNoReply ?? 0;
      return { stage, count, medAgeMs: medAge, stuck };
    })
    .filter((r) => r.count > 0);

  // ── Volume por dia ──
  const byDay = new Map<string, number>();
  for (const l of leads) {
    const day = l.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const toDay = Array.from(byDay.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const maxDay = Math.max(1, ...toDay.map((d) => d.count));

  return (
    <div style={container}>
      <div style={headerRow}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Funil</h1>
          <p style={{ color: "#8f8f9a", fontSize: 13, margin: "4px 0 0" }}>
            Últimos {days} dias · {formatInt(totalLeads)} leads criados
            {totalLeads >= MAX_LEADS ? ` (cap ${MAX_LEADS})` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`/admin/funnel?days=${d}`}
                style={{
                  ...badge,
                  textDecoration: "none",
                  background: d === days ? "#2a2a32" : "#15151a",
                  color: d === days ? "#fff" : "#8f8f9a",
                }}
              >
                {d}d
              </Link>
            ))}
          </div>
          <Link href="/admin" style={backLink}>
            ← admin
          </Link>
        </div>
      </div>

      <div style={cardsGrid}>
        <div style={card}>
          <div style={cardLabel}>Leads criados</div>
          <div style={cardValue}>{formatInt(totalLeads)}</div>
          <div style={cardHint}>
            {formatInt(leadsWithAnyInbound)} responderam (
            {formatPct(leadsWithAnyInbound, totalLeads)})
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Qualified + Won</div>
          <div style={cardValue}>{formatInt(atingiuQualified)}</div>
          <div style={cardHint}>
            {formatPct(atingiuQualified, totalLeads)} dos criados
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Won</div>
          <div style={cardValue}>{formatInt(totalWon)}</div>
          <div style={cardHint}>
            {formatPct(totalWon, atingiuQualified)} dos qualified
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Handoffs</div>
          <div style={cardValue}>{formatInt(totalHandoff)}</div>
          <div style={cardHint}>
            {formatDuration(medianHandoffMs)} mediano até handoff
          </div>
        </div>
      </div>

      <h2 style={sectionTitle}>Funil sequencial</h2>
      <p style={sectionHelp}>
        Cada linha mostra quantos leads atingiram o estágio e o % dos que passaram
        do estágio anterior. Aproximação — lost não diferencia "desqualificou"
        de "perdeu depois do qualified".
      </p>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Estágio</th>
            <th style={{ ...th, textAlign: "right" }}>Leads</th>
            <th style={{ ...th, textAlign: "right" }}>% do anterior</th>
            <th style={{ ...th, textAlign: "right" }}>% do total</th>
            <th style={th}>Proporção</th>
          </tr>
        </thead>
        <tbody>
          {funnelSteps.map((s) => {
            const pctTotal = totalLeads > 0 ? (s.count / totalLeads) * 100 : 0;
            return (
              <tr key={s.label}>
                <td style={td}>{s.label}</td>
                <td style={tdRight}>{formatInt(s.count)}</td>
                <td style={tdRight}>{formatPct(s.count, s.prev)}</td>
                <td style={tdRight}>{formatPct(s.count, totalLeads)}</td>
                <td style={td}>
                  <span style={bar(pctTotal)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Distribuição por status</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: "right" }}>Leads</th>
            <th style={{ ...th, textAlign: "right" }}>% do total</th>
            <th style={th}>Proporção</th>
          </tr>
        </thead>
        <tbody>
          {statusRows.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>
                Sem leads no período.
              </td>
            </tr>
          )}
          {statusRows.map((r) => {
            const pct = totalLeads > 0 ? (r.count / totalLeads) * 100 : 0;
            return (
              <tr key={r.status}>
                <td style={td}>
                  <span style={badge}>{r.status}</span>
                </td>
                <td style={tdRight}>{formatInt(r.count)}</td>
                <td style={tdRight}>{formatPct(r.count, totalLeads)}</td>
                <td style={td}>
                  <span style={bar(pct, statusColor(r.status))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Handoff · pontes</h2>
      <div style={cardsGrid}>
        <div style={card}>
          <div style={cardLabel}>Atingiu handoff</div>
          <div style={cardValue}>{formatInt(totalHandoff)}</div>
          <div style={cardHint}>
            {formatPct(totalHandoff, totalLeads)} dos leads criados
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Pontes abertas</div>
          <div style={cardValue}>{formatInt(bridgesOpen)}</div>
          <div style={cardHint}>corretor ↔ lead ativos agora</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Pontes encerradas</div>
          <div style={cardValue}>{formatInt(bridgesClosed)}</div>
          <div style={cardHint}>handoffs que já fecharam</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Mediano até handoff</div>
          <div style={cardValue}>{formatDuration(medianHandoffMs)}</div>
          <div style={cardHint}>create → handoff_notified_at</div>
        </div>
      </div>

      <h2 style={sectionTitle}>Handoff · motivo</h2>
      <p style={sectionHelp}>
        Por que a Bia entregou o lead pro corretor. "IA incerta" = factcheck
        bloqueou a resposta; "escalação" = handoff por inatividade do corretor;
        "sem motivo" = leads entregues antes do campo existir.
      </p>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Motivo</th>
            <th style={{ ...th, textAlign: "right" }}>Leads</th>
            <th style={{ ...th, textAlign: "right" }}>% dos handoffs</th>
            <th style={th}>Proporção</th>
          </tr>
        </thead>
        <tbody>
          {reasonRows.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>
                Nenhum handoff no período.
              </td>
            </tr>
          )}
          {reasonRows.map((r) => {
            const pct = totalHandoff > 0 ? (r.count / totalHandoff) * 100 : 0;
            return (
              <tr key={r.reason}>
                <td style={td}>
                  <span style={badge}>{r.label}</span>
                </td>
                <td style={tdRight}>{formatInt(r.count)}</td>
                <td style={tdRight}>{formatPct(r.count, totalHandoff)}</td>
                <td style={td}>
                  <span style={bar(pct, "#d9a66b")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Handoff · urgência</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Urgência</th>
            <th style={{ ...th, textAlign: "right" }}>Leads</th>
            <th style={{ ...th, textAlign: "right" }}>% dos handoffs</th>
            <th style={th}>Proporção</th>
          </tr>
        </thead>
        <tbody>
          {urgencyRows.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>
                Nenhum handoff no período.
              </td>
            </tr>
          )}
          {urgencyRows.map((r) => {
            const pct = totalHandoff > 0 ? (r.count / totalHandoff) * 100 : 0;
            return (
              <tr key={r.urgency}>
                <td style={td}>
                  <span style={badge}>{r.urgency}</span>
                </td>
                <td style={tdRight}>{formatInt(r.count)}</td>
                <td style={tdRight}>{formatPct(r.count, totalHandoff)}</td>
                <td style={td}>
                  <span style={bar(pct, URGENCY_COLOR[r.urgency] ?? "#8f8f9a")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Engajamento · mensagens por lead</h2>
      <p style={sectionHelp}>
        Distribuição do total de mensagens (in + out) de cada lead.
        Muitos leads em "0 msgs" → webhook silenciando. Muitos em "1–3" →
        leads morrendo no primeiro contato.
      </p>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Bucket</th>
            <th style={{ ...th, textAlign: "right" }}>Leads</th>
            <th style={{ ...th, textAlign: "right" }}>%</th>
            <th style={th}>Proporção</th>
          </tr>
        </thead>
        <tbody>
          {engagementBuckets.map((b) => {
            const pct = totalLeads > 0 ? (b.count / totalLeads) * 100 : 0;
            return (
              <tr key={b.label}>
                <td style={td}>{b.label}</td>
                <td style={tdRight}>{formatInt(b.count)}</td>
                <td style={tdRight}>{formatPct(b.count, totalLeads)}</td>
                <td style={td}>
                  <span style={bar(pct, "#6b9dd9")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ ...sectionHelp, marginTop: 8 }}>
        Total de mensagens trocadas no período: <strong>{formatInt(totalMsgs)}</strong>.
      </p>

      <h2 style={sectionTitle}>Onde travam · por stage (apenas leads abertos)</h2>
      <p style={sectionHelp}>
        Leads ativos (não-won/lost) agrupados pelo último stage registrado.
        Idade mediana do last_message_at indica há quanto tempo ninguém fala.
        "Sem resposta" = leads que nunca enviaram mensagem inbound.
      </p>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Stage</th>
            <th style={{ ...th, textAlign: "right" }}>Leads abertos</th>
            <th style={{ ...th, textAlign: "right" }}>Sem resposta</th>
            <th style={{ ...th, textAlign: "right" }}>Idade mediana</th>
          </tr>
        </thead>
        <tbody>
          {stageRows.length === 0 && (
            <tr>
              <td style={td} colSpan={4}>
                Sem leads abertos.
              </td>
            </tr>
          )}
          {stageRows.map((r) => (
            <tr key={r.stage}>
              <td style={td}>
                <span style={badge}>{r.stage}</span>
              </td>
              <td style={tdRight}>{formatInt(r.count)}</td>
              <td style={tdRight}>
                {formatInt(r.stuck)}
                <span style={{ color: "#8f8f9a" }}>
                  {r.count > 0
                    ? ` (${Math.round((r.stuck / r.count) * 100)}%)`
                    : ""}
                </span>
              </td>
              <td style={tdRight}>{formatDuration(r.medAgeMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Volume por dia</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Dia</th>
            <th style={{ ...th, textAlign: "right" }}>Leads criados</th>
            <th style={th}>Proporção</th>
          </tr>
        </thead>
        <tbody>
          {toDay.length === 0 && (
            <tr>
              <td style={td} colSpan={3}>
                Sem leads no período.
              </td>
            </tr>
          )}
          {toDay.map((d) => (
            <tr key={d.day}>
              <td style={td}>
                <code style={{ fontSize: 12 }}>{d.day}</code>
              </td>
              <td style={tdRight}>{formatInt(d.count)}</td>
              <td style={td}>
                <span style={bar((d.count / maxDay) * 100, "#6bd99b")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "won":
      return "#6b9dd9";
    case "qualified":
      return "#6bd99b";
    case "qualifying":
      return "#d9cf6b";
    case "lost":
      return "#d96b6b";
    default:
      return "#8f8f9a";
  }
}
