import type { CSSProperties } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dashboard de uso AI (/admin/usage).
 *
 * Lê direto da tabela `ai_usage_log` e agrega em memória — mesmo padrão do
 * endpoint /api/admin/ai-usage (que também existe pra consumo programático
 * no futuro, ex.: gráfico com recharts no frontend).
 *
 * Mantemos SSR e estilo inline pra não destoar do resto do /admin.
 */

const WINDOW_DAYS = 7;

type Row = {
  created_at: string;
  provider: string;
  model: string;
  task: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  duration_ms: number;
  ok: boolean;
  empreendimento_id: string | null;
  lead_id: string | null;
  metadata: Record<string, unknown> | null;
};

async function loadRows(days: number): Promise<Row[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("ai_usage_log")
    .select(
      "created_at, provider, model, task, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, ok, empreendimento_id, lead_id, metadata",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) {
    console.error("[admin/usage] load error:", error);
    return [];
  }
  return (data ?? []) as unknown as Row[];
}

function formatUsd(n: number): string {
  // 4 casas até 1¢; 2 acima. Ajuda pra ver tasks baratas sem arredondar pra 0.
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatMs(n: number): string {
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

// ── Estilos (inline, mesmo padrão de /admin/drafts) ──
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
const errorBadge: CSSProperties = {
  ...badge,
  background: "#3a1f23",
  color: "#ff9fa8",
  border: "1px solid #5a2a30",
};

export default async function UsagePage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await props.searchParams;
  const daysRaw = Number(sp?.days ?? WINDOW_DAYS);
  const days = Math.max(1, Math.min(90, Number.isFinite(daysRaw) ? daysRaw : WINDOW_DAYS));
  const rows = await loadRows(days);

  // Agregações em memória (volume baixo, não vale RPC).
  let totalCost = 0;
  let totalCalls = 0;
  let totalErrors = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  const byTask = new Map<
    string,
    { cost: number; calls: number; input: number; output: number }
  >();
  const byModel = new Map<string, { cost: number; calls: number }>();
  const byDay = new Map<string, { cost: number; calls: number }>();

  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0;
    totalCost += cost;
    totalCalls += 1;
    if (!r.ok) totalErrors += 1;
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
    totalCacheRead += r.cache_read_tokens;

    const t = byTask.get(r.task) ?? { cost: 0, calls: 0, input: 0, output: 0 };
    t.cost += cost;
    t.calls += 1;
    t.input += r.input_tokens;
    t.output += r.output_tokens;
    byTask.set(r.task, t);

    const m = byModel.get(r.model) ?? { cost: 0, calls: 0 };
    m.cost += cost;
    m.calls += 1;
    byModel.set(r.model, m);

    const day = r.created_at.slice(0, 10);
    const d = byDay.get(day) ?? { cost: 0, calls: 0 };
    d.cost += cost;
    d.calls += 1;
    byDay.set(day, d);
  }

  // Breakdown específico de bia_answer por rag_confidence (usa metadata jsonb).
  // Útil pra calibrar o threshold em src/agent/nodes.ts (RAG_STRONG_THRESHOLD):
  //  - muitos "weak" com dúvidas respondendo bem → threshold agressivo demais
  //  - "strong" com alucinação reportada → threshold baixo demais
  // Rows sem metadata.rag_confidence (logs antes da Fatia #3) contam como "—".
  const biaByConf = new Map<
    string,
    { calls: number; cost: number; durationMs: number; withLearnings: number }
  >();
  let biaAnswerTotal = 0;
  for (const r of rows) {
    if (r.task !== "bia_answer") continue;
    biaAnswerTotal += 1;
    const conf =
      (r.metadata && typeof r.metadata.rag_confidence === "string"
        ? (r.metadata.rag_confidence as string)
        : null) ?? "—";
    const hasLearnings = r.metadata?.has_learnings === true;
    const b = biaByConf.get(conf) ?? { calls: 0, cost: 0, durationMs: 0, withLearnings: 0 };
    b.calls += 1;
    b.cost += Number(r.cost_usd) || 0;
    b.durationMs += r.duration_ms || 0;
    if (hasLearnings) b.withLearnings += 1;
    biaByConf.set(conf, b);
  }
  // Ordem fixa pra leitura: strong, weak, none, — (outros).
  const confOrder: Record<string, number> = { strong: 0, weak: 1, none: 2, "—": 3 };
  const toBiaConf = Array.from(biaByConf.entries())
    .map(([conf, v]) => ({
      conf,
      ...v,
      avgMs: v.calls ? Math.round(v.durationMs / v.calls) : 0,
    }))
    .sort((a, b) => (confOrder[a.conf] ?? 99) - (confOrder[b.conf] ?? 99));

  const toTask = Array.from(byTask.entries())
    .map(([task, v]) => ({ task, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const toModel = Array.from(byModel.entries())
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const toDay = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const recent = rows.slice(0, 20);

  // Média diária (pra projeção mensal rápida).
  const avgPerDay = toDay.length ? totalCost / toDay.length : 0;
  const projMonth = avgPerDay * 30;

  return (
    <div style={container}>
      <div style={headerRow}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Uso de IA</h1>
          <p style={{ color: "#8f8f9a", fontSize: 13, margin: "4px 0 0" }}>
            Últimos {days} dias · {formatInt(totalCalls)} chamadas
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 7, 30].map((d) => (
              <Link
                key={d}
                href={`/admin/usage?days=${d}`}
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
          <div style={cardLabel}>Custo total</div>
          <div style={cardValue}>{formatUsd(totalCost)}</div>
          <div style={cardHint}>
            média {formatUsd(avgPerDay)}/dia · projeção 30d {formatUsd(projMonth)}
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Chamadas</div>
          <div style={cardValue}>{formatInt(totalCalls)}</div>
          <div style={cardHint}>
            {totalErrors > 0 ? `${totalErrors} com erro` : "sem erros"}
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Tokens input</div>
          <div style={cardValue}>{formatInt(totalInput)}</div>
          <div style={cardHint}>cache read {formatInt(totalCacheRead)}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Tokens output</div>
          <div style={cardValue}>{formatInt(totalOutput)}</div>
          <div style={cardHint}>&nbsp;</div>
        </div>
      </div>

      <h2 style={sectionTitle}>Por task</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Task</th>
            <th style={{ ...th, textAlign: "right" }}>Chamadas</th>
            <th style={{ ...th, textAlign: "right" }}>Input</th>
            <th style={{ ...th, textAlign: "right" }}>Output</th>
            <th style={{ ...th, textAlign: "right" }}>Custo</th>
            <th style={{ ...th, textAlign: "right" }}>% do total</th>
          </tr>
        </thead>
        <tbody>
          {toTask.length === 0 && (
            <tr>
              <td style={td} colSpan={6}>
                Sem chamadas no período.
              </td>
            </tr>
          )}
          {toTask.map((t) => (
            <tr key={t.task}>
              <td style={td}>
                <span style={badge}>{t.task}</span>
              </td>
              <td style={tdRight}>{formatInt(t.calls)}</td>
              <td style={tdRight}>{formatInt(t.input)}</td>
              <td style={tdRight}>{formatInt(t.output)}</td>
              <td style={tdRight}>{formatUsd(t.cost)}</td>
              <td style={tdRight}>
                {totalCost > 0 ? `${Math.round((t.cost / totalCost) * 100)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Bia · confiança do RAG</h2>
      <p style={{ color: "#8f8f9a", fontSize: 12, margin: "0 0 10px 2px" }}>
        Distribuição das respostas da Bia por confiança do retrieval semântico.
        Threshold em <code>src/agent/nodes.ts</code> (<code>RAG_STRONG_THRESHOLD = 0.55</code>).
        Calibre observando casos com <code>weak</code>/<code>none</code> que respondem bem
        (threshold alto demais) ou <code>strong</code> com alucinação (threshold baixo demais).
      </p>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Confiança</th>
            <th style={{ ...th, textAlign: "right" }}>Chamadas</th>
            <th style={{ ...th, textAlign: "right" }}>% bia_answer</th>
            <th style={{ ...th, textAlign: "right" }}>Com learnings</th>
            <th style={{ ...th, textAlign: "right" }}>Duração média</th>
            <th style={{ ...th, textAlign: "right" }}>Custo</th>
          </tr>
        </thead>
        <tbody>
          {toBiaConf.length === 0 && (
            <tr>
              <td style={td} colSpan={6}>
                Sem chamadas de bia_answer no período.
              </td>
            </tr>
          )}
          {toBiaConf.map((b) => (
            <tr key={b.conf}>
              <td style={td}>
                <span style={badge}>{b.conf}</span>
              </td>
              <td style={tdRight}>{formatInt(b.calls)}</td>
              <td style={tdRight}>
                {biaAnswerTotal > 0
                  ? `${Math.round((b.calls / biaAnswerTotal) * 100)}%`
                  : "—"}
              </td>
              <td style={tdRight}>
                {b.withLearnings}
                <span style={{ color: "#8f8f9a" }}>
                  {b.calls > 0
                    ? ` (${Math.round((b.withLearnings / b.calls) * 100)}%)`
                    : ""}
                </span>
              </td>
              <td style={tdRight}>{formatMs(b.avgMs)}</td>
              <td style={tdRight}>{formatUsd(b.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Por modelo</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Modelo</th>
            <th style={{ ...th, textAlign: "right" }}>Chamadas</th>
            <th style={{ ...th, textAlign: "right" }}>Custo</th>
          </tr>
        </thead>
        <tbody>
          {toModel.map((m) => (
            <tr key={m.model}>
              <td style={td}>
                <code style={{ fontSize: 12 }}>{m.model}</code>
              </td>
              <td style={tdRight}>{formatInt(m.calls)}</td>
              <td style={tdRight}>{formatUsd(m.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Por dia</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Dia</th>
            <th style={{ ...th, textAlign: "right" }}>Chamadas</th>
            <th style={{ ...th, textAlign: "right" }}>Custo</th>
          </tr>
        </thead>
        <tbody>
          {toDay.map((d) => (
            <tr key={d.day}>
              <td style={td}>{d.day}</td>
              <td style={tdRight}>{formatInt(d.calls)}</td>
              <td style={tdRight}>{formatUsd(d.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={sectionTitle}>Últimas chamadas</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Quando</th>
            <th style={th}>Task</th>
            <th style={th}>Modelo</th>
            <th style={{ ...th, textAlign: "right" }}>Input</th>
            <th style={{ ...th, textAlign: "right" }}>Output</th>
            <th style={{ ...th, textAlign: "right" }}>Cache r/w</th>
            <th style={{ ...th, textAlign: "right" }}>Duração</th>
            <th style={{ ...th, textAlign: "right" }}>Custo</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => (
            <tr key={`${r.created_at}-${i}`}>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {new Date(r.created_at).toLocaleString("pt-BR", {
                  hour12: false,
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td style={td}>
                <span style={badge}>{r.task}</span>
              </td>
              <td style={td}>
                <code style={{ fontSize: 11 }}>{r.model}</code>
              </td>
              <td style={tdRight}>{formatInt(r.input_tokens)}</td>
              <td style={tdRight}>{formatInt(r.output_tokens)}</td>
              <td style={tdRight}>
                {r.cache_read_tokens || r.cache_write_tokens
                  ? `${formatInt(r.cache_read_tokens)}/${formatInt(r.cache_write_tokens)}`
                  : "—"}
              </td>
              <td style={tdRight}>{formatMs(r.duration_ms)}</td>
              <td style={tdRight}>{formatUsd(Number(r.cost_usd) || 0)}</td>
              <td style={td}>
                {r.ok ? (
                  <span style={badge}>ok</span>
                ) : (
                  <span style={errorBadge}>erro</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: "#8f8f9a", fontSize: 12, marginTop: 16 }}>
        Custo calculado na hora do log com a tabela de preços em{" "}
        <code>src/lib/ai-usage.ts</code>. Linhas antigas mantêm o preço da época.
      </p>
    </div>
  );
}
