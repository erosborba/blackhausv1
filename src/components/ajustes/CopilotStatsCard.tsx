/**
 * Vanguard · Track 3 · Slice 3.6b — painel de telemetria do copilot.
 *
 * Display-only (server-component-friendly): recebe o resultado de
 * `getSuggestionStats` e renderiza um card compacto com as duas
 * métricas que importam (useRate + noEditRate) e top motivos de
 * descarte. Quando não há dados suficientes pra denominador razoável,
 * mostra "—" em vez de 0% (que seria enganoso).
 *
 * Renderizado no topo da aba "IA" em /ajustes — dá pro admin decidir
 * se vale ou não ligar `finance_*_mode=direct`: baixo useRate ou alto
 * editRate = Bia ainda não tá pronta pra autonomia.
 */
import { Card } from "@/components/ui/Card";
import type { CopilotSuggestionStats } from "@/lib/copilot-stats";

export function CopilotStatsCard({ stats }: { stats: CopilotSuggestionStats }) {
  const useRate = stats.useRate;
  const noEditRate = stats.noEditRate;

  return (
    <Card style={{ padding: "18px 20px", marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Copilot · últimos {stats.daysBack} dias
          </h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 11.5,
              color: "var(--ink-3)",
            }}
          >
            {stats.total === 0
              ? "Nenhuma sugestão criada nesse período."
              : `${stats.total} sugestões · ${stats.pending} pending · ${stats.sent} enviadas · ${stats.discarded} descartadas`}
          </p>
        </div>
      </div>

      {/* Métricas principais — grid 2 colunas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: stats.topDiscardReasons.length > 0 ? 14 : 0,
        }}
      >
        <Metric
          label="Taxa de aproveitamento"
          value={fmtPct(useRate)}
          hint={
            useRate === null
              ? "sem dados resolvidos"
              : `${stats.sent} enviadas de ${stats.sent + stats.discarded} resolvidas`
          }
          tone={useRate === null ? "muted" : useRate >= 0.7 ? "ok" : useRate >= 0.4 ? "warm" : "hot"}
        />
        <Metric
          label="Texto aceito sem edição"
          value={fmtPct(noEditRate)}
          hint={
            noEditRate === null
              ? "sem envios no período"
              : `${stats.sent - stats.sentEdited} de ${stats.sent} enviadas`
          }
          tone={
            noEditRate === null ? "muted" : noEditRate >= 0.7 ? "ok" : noEditRate >= 0.4 ? "warm" : "hot"
          }
        />
      </div>

      {/* Top motivos de descarte — só aparece quando tem dados */}
      {stats.topDiscardReasons.length > 0 ? (
        <div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--ink-4)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Motivos de descarte
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {stats.topDiscardReasons.map((r) => (
              <div
                key={r.reason}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--ink-2)",
                }}
              >
                <span>{prettyReason(r.reason)}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--ink-4)",
                  }}
                >
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "ok" | "warm" | "hot" | "muted";
}) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warm"
        ? "var(--warm)"
        : tone === "hot"
          ? "var(--hot)"
          : "var(--ink-4)";
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          marginTop: 4,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

/**
 * Mapeia slug do enum de descarte pra label amigável. Mantém espelho
 * com `DISCARD_REASONS` em `SuggestionsCard.tsx` — se adicionar motivo
 * novo lá, adicionar aqui também (ou a UI mostra o slug cru).
 */
function prettyReason(slug: string): string {
  const map: Record<string, string> = {
    calculo_errado: "Cálculo errado",
    taxa_desatualizada: "Taxa desatualizada",
    lead_ja_sabia: "Lead já sabia",
    timing_ruim: "Timing ruim",
    vou_reformular: "Vou reformular",
    outro: "Outro",
    "(sem motivo)": "Sem motivo informado",
  };
  return map[slug] ?? slug;
}
