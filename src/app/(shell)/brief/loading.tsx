import { Skeleton, SkeletonBlock } from "@/components/ui/Skeleton";
import "./brief.css";

/**
 * Loading state do /brief enquanto getPanorama() resolve. Mimica
 * layout final: titulo + 5 KPIs + grid de ações.
 */
export default function BriefLoading() {
  return (
    <main className="page-body brief-page">
      <div className="brief-wrap">
        <header className="brief-head">
          <h1 className="display">
            <Skeleton width={240} height={36} radius={8} />
          </h1>
          <p className="brief-intro">
            <Skeleton width="80%" height={14} />
          </p>
        </header>

        <section className="kpi-row" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} height={90} />
          ))}
        </section>

        <section className="actions-section">
          <h2 className="section-h">
            <Skeleton width={140} height={14} />
          </h2>
          <div className="action-grid" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock key={i} height={140} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
