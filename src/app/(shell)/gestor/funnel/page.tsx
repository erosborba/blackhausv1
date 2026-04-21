import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import {
  fetchFunnel,
  formatHours,
  STAGE_LABEL,
  type FunnelStage,
} from "@/lib/funnel-analytics";
import "../gestor.css";
import "./funnel.css";

export const dynamic = "force-dynamic";

/**
 * /gestor/funnel — funil analítico de conversão por stage.
 *
 * Substitui o /admin/funnel aproximado (que lia snapshot de
 * `leads.stage`) pela RPC `pipeline_conversion_funnel`, baseada em
 * `lead_events.stage_change`. Fonte única da verdade.
 *
 * Track 1 · Slice 1.4. Invariants: I-2 (exclui test), I-7 (audit-based).
 */
export default async function GestorFunnelPage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const role = await getCurrentRole();
  if (!can(role, "gestor.view")) redirect("/brief");

  const sp = await props.searchParams;
  const daysRaw = Number(sp?.days ?? 30);
  const days = daysRaw === 7 || daysRaw === 90 ? daysRaw : 30;

  const funnel = await fetchFunnel(days).catch((e) => ({
    sinceDays: days,
    stages: [] as FunnelStage[],
    overallConversionRate: null as number | null,
    error: e instanceof Error ? e.message : String(e),
  }));

  const stages = funnel.stages;
  const maxEntered = Math.max(1, ...stages.map((s) => s.entered));
  const err = "error" in funnel ? funnel.error : null;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Gestor", href: "/gestor" },
          { label: "Funil" },
        ]}
      />
      <main className="page-body gestor-page">
        <div className="gestor-wrap">
          <header className="gestor-head">
            <div>
              <h1 className="display">Funil de conversão</h1>
              <p className="gestor-sub">
                Últimos {days} dias · baseado em <code>lead_events.stage_change</code>{" "}
                · exclui test phones
              </p>
            </div>
            <div className="window-switch">
              {[7, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/gestor/funnel?days=${d}`}
                  className={`window-chip${days === d ? " active" : ""}`}
                >
                  {d}d
                </Link>
              ))}
            </div>
          </header>

          {err ? (
            <div className="funnel-error">
              Erro ao carregar funnel: <code>{err}</code>
              <div className="funnel-error-hint">
                Migration <code>20260421000004_pipeline_conversion_funnel.sql</code>{" "}
                aplicada?
              </div>
            </div>
          ) : null}

          {!err && stages.length === 0 ? (
            <div className="funnel-empty">
              Sem dados nos últimos {days} dias. Leads novos passarão pelas
              stages conforme a Bia qualificar.
            </div>
          ) : null}

          {!err && stages.length > 0 ? (
            <>
              <div className="funnel-kpis">
                <Kpi
                  label="Leads no topo"
                  value={stages[0]?.entered.toLocaleString("pt-BR") ?? "0"}
                  hint={STAGE_LABEL[stages[0]?.stage ?? ""] ?? ""}
                />
                <Kpi
                  label="Conversão total"
                  value={
                    funnel.overallConversionRate !== null
                      ? `${(funnel.overallConversionRate * 100).toFixed(1)}%`
                      : "—"
                  }
                  hint={`topo → ${STAGE_LABEL[stages[stages.length - 1]?.stage ?? ""] ?? "fim"}`}
                />
                <Kpi
                  label="Gargalo principal"
                  value={pickBottleneck(stages)?.label ?? "—"}
                  hint={pickBottleneck(stages)?.hint ?? ""}
                />
              </div>

              <section className="funnel-section">
                <h2>Fluxo por stage</h2>
                <div className="funnel-bars">
                  {stages.map((s) => {
                    const width = (s.entered / maxEntered) * 100;
                    const dropRate =
                      s.entered > 0 ? s.dropped / s.entered : 0;
                    return (
                      <div key={s.stage} className="funnel-row">
                        <div className="funnel-row-head">
                          <strong>{STAGE_LABEL[s.stage] ?? s.stage}</strong>
                          <span className="mono">
                            {s.entered.toLocaleString("pt-BR")} entraram
                          </span>
                        </div>
                        <div className="funnel-bar">
                          <span
                            className="funnel-bar-fill"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <div className="funnel-row-meta">
                          <span>
                            Avançou: <strong>{s.exited_to_next.toLocaleString("pt-BR")}</strong>
                          </span>
                          <span>
                            Parou:{" "}
                            <strong
                              className={dropRate > 0.5 ? "hot" : dropRate > 0.3 ? "warm" : ""}
                            >
                              {s.dropped.toLocaleString("pt-BR")}
                            </strong>{" "}
                            ({(dropRate * 100).toFixed(0)}%)
                          </span>
                          <span>
                            Tempo mediano: <strong>{formatHours(s.median_time_in_stage_h)}</strong>
                          </span>
                          <span>
                            p90: <strong>{formatHours(s.p90_time_in_stage_h)}</strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="funnel-kpi">
      <div className="funnel-kpi-label">{label}</div>
      <div className="funnel-kpi-value">{value}</div>
      {hint ? <div className="funnel-kpi-hint">{hint}</div> : null}
    </div>
  );
}

function pickBottleneck(
  stages: FunnelStage[],
): { label: string; hint: string } | null {
  // Gargalo = stage com maior drop rate (mínimo 5 entradas pra ser significativo).
  let worst: { stage: FunnelStage; rate: number } | null = null;
  for (const s of stages) {
    if (s.entered < 5) continue;
    const rate = s.dropped / s.entered;
    if (!worst || rate > worst.rate) worst = { stage: s, rate };
  }
  if (!worst) return null;
  return {
    label: STAGE_LABEL[worst.stage.stage] ?? worst.stage.stage,
    hint: `${(worst.rate * 100).toFixed(0)}% param aqui`,
  };
}
