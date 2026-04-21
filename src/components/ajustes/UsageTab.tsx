"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Aba Usage & Custos do /ajustes. Consome /api/admin/ai-usage que já
 * existia em Phase 0 e agrega ai_usage_log por task/model/day.
 *
 * Janela switchável 1/7/30d. Sparkline simples feita com divs (sem
 * dep nova). Mantém estilo das outras abas (dark neumorphism).
 */

type UsageResponse = {
  ok: boolean;
  window: { days: number; since: string };
  totals: {
    cost_usd: number;
    calls: number;
    errors: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
  by_task: Array<{ task: string; cost: number; calls: number; input: number; output: number }>;
  by_model: Array<{ model: string; cost: number; calls: number }>;
  by_day: Array<{ day: string; cost: number; calls: number }>;
  recent: Array<{
    created_at: string;
    model: string;
    task: string;
    cost_usd: number;
    ok: boolean;
  }>;
  error?: string;
};

const WINDOWS = [1, 7, 30] as const;

export function UsageTab() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/ai-usage?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: UsageResponse) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? "falha ao carregar");
        } else {
          setData(json);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "erro de rede");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading) return <EmptyState variant="loading" title="Carregando uso…" />;
  if (error) return <EmptyState variant="error" title="Não foi possível carregar" hint={error} />;
  if (!data) return null;

  const maxDayCost = Math.max(0.0001, ...data.by_day.map((d) => d.cost));
  const avgPerCall = data.totals.calls > 0 ? data.totals.cost_usd / data.totals.calls : 0;
  const cacheHitRate =
    data.totals.cache_read_tokens + data.totals.input_tokens > 0
      ? (data.totals.cache_read_tokens /
          (data.totals.cache_read_tokens + data.totals.input_tokens)) *
        100
      : 0;

  return (
    <div>
      <div className="usage-window" role="tablist" aria-label="Janela de tempo">
        {WINDOWS.map((d) => (
          <button
            key={d}
            type="button"
            className={`usage-window-btn ${days === d ? "is-active" : ""}`}
            onClick={() => setDays(d)}
          >
            {d}d
          </button>
        ))}
      </div>

      <div className="usage-cards">
        <UsageCard
          label="Custo total"
          value={formatUsd(data.totals.cost_usd)}
          hint={`${formatInt(data.totals.calls)} chamadas`}
        />
        <UsageCard
          label="Médio por chamada"
          value={formatUsd(avgPerCall)}
          hint={data.totals.errors > 0 ? `${data.totals.errors} erros` : "sem erros"}
        />
        <UsageCard
          label="Tokens in/out"
          value={`${formatCompact(data.totals.input_tokens)}/${formatCompact(data.totals.output_tokens)}`}
          hint="ignora cache"
        />
        <UsageCard
          label="Cache hit"
          value={`${cacheHitRate.toFixed(0)}%`}
          hint={`${formatCompact(data.totals.cache_read_tokens)} lidos do cache`}
        />
      </div>

      <section className="usage-section">
        <h3 className="usage-section-title">Custo por dia</h3>
        {data.by_day.length === 0 ? (
          <div className="usage-table" style={{ padding: 20, textAlign: "center", color: "var(--ink-4)" }}>
            Nenhuma chamada no período.
          </div>
        ) : (
          <div className="usage-spark" aria-label="Série diária de custo">
            {data.by_day.map((d) => (
              <div
                key={d.day}
                className="usage-spark-bar"
                style={{ height: `${Math.max(4, (d.cost / maxDayCost) * 100)}%` }}
                title={`${d.day}: ${formatUsd(d.cost)} (${d.calls} chamadas)`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="usage-section">
        <h3 className="usage-section-title">Por task</h3>
        <div className="usage-table">
          <div className="usage-tr usage-tr-head">
            <div>Task</div>
            <div className="num">Calls</div>
            <div className="num">Custo</div>
            <div className="num">% total</div>
          </div>
          {data.by_task.slice(0, 10).map((t) => {
            const pct = data.totals.cost_usd > 0 ? (t.cost / data.totals.cost_usd) * 100 : 0;
            return (
              <div key={t.task} className="usage-tr">
                <div>{t.task}</div>
                <div className="num">{formatInt(t.calls)}</div>
                <div className="num">{formatUsd(t.cost)}</div>
                <div className="num">{pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="usage-section">
        <h3 className="usage-section-title">Por modelo</h3>
        <div className="usage-table">
          <div className="usage-tr usage-tr-head">
            <div>Modelo</div>
            <div className="num">Calls</div>
            <div className="num">Custo</div>
            <div className="num">% total</div>
          </div>
          {data.by_model.slice(0, 10).map((m) => {
            const pct = data.totals.cost_usd > 0 ? (m.cost / data.totals.cost_usd) * 100 : 0;
            return (
              <div key={m.model} className="usage-tr">
                <div>{m.model}</div>
                <div className="num">{formatInt(m.calls)}</div>
                <div className="num">{formatUsd(m.cost)}</div>
                <div className="num">{pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function UsageCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="usage-card">
      <div className="usage-card-label">{label}</div>
      <div className="usage-card-value">{value}</div>
      {hint ? <div className="usage-card-hint">{hint}</div> : null}
    </div>
  );
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
