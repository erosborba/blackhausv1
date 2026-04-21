import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import { fetchRagGapReport } from "@/lib/rag-gap";
import "../gestor.css";
import "./rag-gaps.css";

export const dynamic = "force-dynamic";

/**
 * /gestor/rag-gaps — Track 1 · Slice 1.5.
 *
 * Empreendimentos que apareceram em mensagens da Bia imediatamente antes
 * de handoffs marcados como `tarde` ("Bia segurou demais"). Gap score
 * alto = Bia tentou resolver com RAG ralo e falhou.
 *
 * Ação esperada: admin clica no empreendimento → revisa FAQs/RAG →
 * (eventualmente) adiciona Q&A via /handoff feedback flow.
 */
export default async function RagGapsPage(props: {
  searchParams: Promise<{ days?: string }>;
}) {
  const role = await getCurrentRole();
  if (!can(role, "gestor.view")) redirect("/brief");

  const sp = await props.searchParams;
  const daysRaw = Number(sp?.days ?? 30);
  const days = daysRaw === 7 || daysRaw === 90 ? daysRaw : 30;

  const report = await fetchRagGapReport(days).catch((e) => ({
    sinceDays: days,
    totalHandoffsAnalyzed: 0,
    entries: [],
    error: e instanceof Error ? e.message : String(e),
  }));

  const err = "error" in report ? report.error : null;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Gestor", href: "/gestor" },
          { label: "RAG gaps" },
        ]}
      />
      <main className="page-body gestor-page">
        <div className="gestor-wrap">
          <header className="gestor-head">
            <div>
              <h1 className="display">Gaps de RAG</h1>
              <p className="gestor-sub">
                Empreendimentos citados antes de handoffs avaliados como
                &ldquo;tarde demais&rdquo;. Gap score = quanto a Bia segurou
                sem ter o que responder.
              </p>
            </div>
            <div className="window-switch">
              {[7, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/gestor/rag-gaps?days=${d}`}
                  className={`window-chip${days === d ? " active" : ""}`}
                >
                  {d}d
                </Link>
              ))}
            </div>
          </header>

          {err ? (
            <div className="gaps-error">
              Erro ao carregar: <code>{err}</code>
            </div>
          ) : null}

          {!err && report.entries.length === 0 ? (
            <div className="gaps-empty">
              Sem gaps nos últimos {days} dias — ou ainda não há
              handoff_feedback com rating <code>tarde</code>/<code>bom</code>.
              Handoffs analisados: {report.totalHandoffsAnalyzed}.
            </div>
          ) : null}

          {!err && report.entries.length > 0 ? (
            <>
              <div className="gaps-meta">
                {report.totalHandoffsAnalyzed} handoffs analisados ·{" "}
                {report.entries.length} empreendimentos com citações
              </div>
              <section className="gaps-table-wrap">
                <table className="gaps-table">
                  <thead>
                    <tr>
                      <th>Empreendimento</th>
                      <th className="num">Gap</th>
                      <th className="num">Tarde</th>
                      <th className="num">Bom</th>
                      <th>Último caso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.entries.map((e) => {
                      const tone =
                        e.gapScore >= 3 ? "hot" : e.gapScore >= 1 ? "warm" : "cool";
                      return (
                        <tr key={e.empreendimentoId}>
                          <td>
                            <div className="gaps-emp">
                              <strong>{e.nome ?? e.empreendimentoId}</strong>
                              {e.slug ? (
                                <span className="slug">/{e.slug}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className={`num gap-score tone-${tone}`}>
                            {e.gapScore.toFixed(1)}
                          </td>
                          <td className="num">{e.citedTardeCount}</td>
                          <td className="num">{e.citedBomCount}</td>
                          <td>
                            <Link
                              href={`/inbox/${e.lastLeadId}`}
                              className="gaps-leadlink"
                            >
                              abrir conversa →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </>
  );
}
