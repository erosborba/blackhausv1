import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import { loadGestorStats, type GestorWindow } from "@/lib/gestor-stats";
import {
  HANDOFF_REASON_LABEL,
  HANDOFF_URGENCY_EMOJI,
} from "@/lib/handoff-copy";
import {
  HANDOFF_RATING_EMOJI,
  HANDOFF_RATING_LABEL,
  HANDOFF_RATINGS,
} from "@/lib/handoff-feedback";
import { Sparkline } from "@/components/gestor/Sparkline";
import "./gestor.css";

export const dynamic = "force-dynamic";

/**
 * /gestor — operational dashboard.
 *
 * Substitui /admin/funnel. Foco: KPIs + sparklines + alertas + handoff
 * accuracy (novo sinal vindo de handoff_feedback). Tabelas detalhadas
 * entram no final (motivo/urgência).
 *
 * Conversão por corretor fica fora do escopo na Phase 2 — depende de
 * auth/assignment real que só chega na Phase 5.
 */
export default async function GestorPage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const role = await getCurrentRole();
  if (!can(role, "gestor.view")) redirect("/brief");

  const sp = await props.searchParams;
  const daysRaw = Number(sp?.days ?? 30);
  const days: GestorWindow =
    daysRaw === 7 || daysRaw === 90 ? (daysRaw as GestorWindow) : 30;

  const s = await loadGestorStats(days);

  return (
    <>
      <Topbar
        crumbs={[{ label: "Gestor" }, { label: `Últimos ${s.window_days} dias` }]}
      />
      <main className="page-body gestor-page">
        <div className="gestor-wrap">
          <header className="gestor-head">
            <div>
              <h1 className="display">Gestor</h1>
              <p className="gestor-sub">
                Panorama operacional · {s.total_leads} leads criados no período
              </p>
            </div>
            <div className="window-switch">
              <Link href={`/gestor/funnel?days=${days}`} className="switch-btn">
                Funil →
              </Link>
              <Link href={`/gestor/rag-gaps?days=${days}`} className="switch-btn">
                RAG gaps →
              </Link>
              <Link href="/gestor/health" className="switch-btn">
                Health →
              </Link>
              {[7, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/gestor?days=${d}`}
                  className={`switch-btn ${d === s.window_days ? "on" : ""}`}
                >
                  {d}d
                </Link>
              ))}
            </div>
          </header>

          {s.alerts.length > 0 ? (
            <section className="alerts-row">
              {s.alerts.map((a, i) => (
                <div key={i} className={`alert-card sev-${a.severity}`}>
                  <div className="alert-msg">{a.message}</div>
                  {a.detail ? <div className="alert-hint">{a.detail}</div> : null}
                </div>
              ))}
            </section>
          ) : null}

          <section className="gestor-kpis">
            <Kpi
              label="Leads criados"
              value={s.total_leads}
              sub={`${s.responded_count} responderam (${fmtPct(s.response_rate)})`}
              spark={s.leads_per_day}
              sparkLabels={s.days_labels}
              tone="cool"
            />
            <Kpi
              label="Mensagens"
              value={sum(s.messages_per_day)}
              sub={`Pico: ${Math.max(0, ...s.messages_per_day)} / dia`}
              spark={s.messages_per_day}
              sparkLabels={s.days_labels}
              tone="neutral"
            />
            <Kpi
              label="Handoffs"
              value={s.handoff_count}
              sub={`${fmtPct(s.handoff_count / (s.total_leads || 1))} dos leads`}
              spark={s.handoffs_per_day}
              sparkLabels={s.days_labels}
              tone="warm"
            />
            <Kpi
              label="Conversão"
              value={`${fmtPct(s.conversion_rate)}`}
              sub={`${s.won} won de ${s.qualified_count} qualified`}
              tone="hot"
            />
          </section>

          <section className="gestor-grid">
            <div className="panel">
              <h2 className="panel-h">Acurácia de handoff</h2>
              <p className="panel-sub">
                Feedback dos corretores sobre o timing da escalação. Lead_ruim
                sai do denominador.
              </p>
              {s.handoff_feedback.total === 0 ? (
                <div className="empty-sm">
                  Nenhum feedback ainda. Avalie pelo /handoff/[leadId].
                </div>
              ) : (
                <>
                  <div className="accuracy-big">
                    {s.handoff_feedback.accuracy !== null
                      ? `${(s.handoff_feedback.accuracy * 100).toFixed(0)}%`
                      : "—"}
                  </div>
                  <div className="accuracy-hint">
                    {s.handoff_feedback.total} avaliações · janela {s.window_days}d
                  </div>
                  <div className="rating-bars">
                    {HANDOFF_RATINGS.map((r) => {
                      const c = s.handoff_feedback.counts[r];
                      const pct = s.handoff_feedback.total
                        ? (c / s.handoff_feedback.total) * 100
                        : 0;
                      return (
                        <div key={r} className="rating-bar">
                          <div className="rating-label">
                            <span>{HANDOFF_RATING_EMOJI[r]}</span>
                            <span>{HANDOFF_RATING_LABEL[r]}</span>
                          </div>
                          <div className="rating-track">
                            <div
                              className={`rating-fill r-${r}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="rating-count">{c}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="panel">
              <h2 className="panel-h">Handoff · motivo</h2>
              <p className="panel-sub">
                Por que a Bia escalou. Concentração em "IA incerta" sugere RAG
                fraco; "objeção complexa" alto = corretor precisa de mais
                argumentos no playbook.
              </p>
              {s.handoff_by_reason.length === 0 ? (
                <div className="empty-sm">Nenhum handoff no período.</div>
              ) : (
                <div className="bar-list">
                  {s.handoff_by_reason.map((r) => {
                    const pct = s.handoff_count
                      ? (r.count / s.handoff_count) * 100
                      : 0;
                    const label =
                      r.reason === "sem_motivo"
                        ? "sem motivo"
                        : HANDOFF_REASON_LABEL[r.reason];
                    return (
                      <div key={r.reason} className="bar-row">
                        <div className="bar-label">{label}</div>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="bar-count">
                          {r.count} · {pct.toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="panel">
              <h2 className="panel-h">Handoff · urgência</h2>
              <p className="panel-sub">
                Distribuição da severidade atribuída pelo router.
              </p>
              {s.handoff_by_urgency.length === 0 ? (
                <div className="empty-sm">Nenhum handoff no período.</div>
              ) : (
                <div className="bar-list">
                  {s.handoff_by_urgency.map((r) => {
                    const pct = s.handoff_count
                      ? (r.count / s.handoff_count) * 100
                      : 0;
                    const emoji =
                      r.urgency === "sem_urgencia"
                        ? "❓"
                        : HANDOFF_URGENCY_EMOJI[r.urgency];
                    return (
                      <div key={r.urgency} className="bar-row">
                        <div className="bar-label">
                          {emoji} {r.urgency === "sem_urgencia" ? "sem urgência" : r.urgency}
                        </div>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="bar-count">
                          {r.count} · {pct.toFixed(0)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  spark,
  sparkLabels,
  tone,
}: {
  label: string;
  value: number | string;
  sub: string;
  spark?: number[];
  sparkLabels?: string[];
  tone: "hot" | "warm" | "cool" | "neutral";
}) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-hint">{sub}</div>
      {spark && spark.length > 0 ? (
        <div className="kpi-spark">
          <Sparkline values={spark} labels={sparkLabels} />
        </div>
      ) : null}
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
