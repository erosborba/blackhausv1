import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import {
  formatDelta,
  formatMetric,
  loadHealth,
  type HealthMetric,
} from "@/lib/gestor-health";
import "../gestor.css";
import "./health.css";

export const dynamic = "force-dynamic";

/**
 * /gestor/health — regression dashboard (G-3 do VANGUARD).
 *
 * 4 métricas de saúde operacional, cada uma comparada vs janela anterior
 * (últimos 7d vs 7d prévios). Degradação > 20% vira flag vermelho.
 *
 * Track 1 · Slice 1.6.
 */
export default async function HealthPage() {
  const role = await getCurrentRole();
  if (!can(role, "gestor.view")) redirect("/brief");

  const health = await loadHealth();

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Gestor", href: "/gestor" },
          { label: "Health" },
        ]}
      />
      <main className="page-body gestor-page">
        <div className="gestor-wrap">
          <header className="gestor-head">
            <div>
              <h1 className="display">Health — anti-drift</h1>
              <p className="gestor-sub">
                4 métricas que a Bia não pode regredir em silêncio. Comparação
                últimos {health.windowDays}d vs {health.windowDays}d prévios ·
                threshold de alerta: 20%.
              </p>
            </div>
            <div className="window-switch">
              <Link href="/gestor" className="switch-btn">
                ← Gestor
              </Link>
            </div>
          </header>

          <section className="health-grid">
            {health.metrics.map((m) => (
              <MetricCard key={m.key} m={m} />
            ))}
          </section>

          <section className="health-legend">
            <h3>Como ler</h3>
            <ul>
              <li>
                <strong>Taxa de handoff</strong> subindo = Bia desistindo mais
                (pode ser drift no prompt que puxa handoff fácil).
              </li>
              <li>
                <strong>Taxa de resposta</strong> caindo = lead não engaja com
                o primeiro turno (saudação ruim, pergunta mal formulada).
              </li>
              <li>
                <strong>Custo por lead</strong> subindo = prompt ficou verboso
                ou retrieval puxa chunks demais.
              </li>
              <li>
                <strong>Eval pass rate</strong> caindo = regressão detectada
                pelo harness. Investigar diff em <code>src/agent/**</code>.
              </li>
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}

function MetricCard({ m }: { m: HealthMetric }) {
  const toneClass =
    m.status === "degraded"
      ? "tone-hot"
      : m.status === "warn"
        ? "tone-warm"
        : m.status === "no_data"
          ? "tone-muted"
          : "tone-ok";

  return (
    <div className={`health-card ${toneClass}`}>
      <div className="health-label">{m.label}</div>
      <div className="health-value">{formatMetric(m.current, m.unit)}</div>
      <div className="health-delta">
        <span>vs prévio</span>
        <strong>{formatDelta(m.deltaPct)}</strong>
      </div>
      <div className="health-prev">
        prévio: {formatMetric(m.previous, m.unit)}
      </div>
      {m.hint ? <div className="health-hint">{m.hint}</div> : null}
      {m.status === "degraded" ? (
        <div className="health-alert">⚠ Degradação acima do threshold</div>
      ) : null}
      {m.status === "no_data" ? (
        <div className="health-alert muted">Sem dados suficientes</div>
      ) : null}
    </div>
  );
}
