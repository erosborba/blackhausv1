import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { supabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import type { Empreendimento, Faq } from "@/lib/empreendimentos-shared";
import {
  getUnidadesMatrix,
  getUnidadesSummary,
  formatPrecoRange,
  UNIDADE_STATUS_LABEL,
} from "@/lib/unidades";
import "./detail.css";

export const dynamic = "force-dynamic";

type Tab = "visao" | "tipologias" | "unidades" | "faqs" | "docs";

const TABS: { key: Tab; label: string }[] = [
  { key: "visao", label: "Visão" },
  { key: "tipologias", label: "Tipologias" },
  { key: "unidades", label: "Unidades" },
  { key: "faqs", label: "FAQs IA" },
  { key: "docs", label: "Docs" },
];

export default async function EmpreendimentoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const role = await getCurrentRole();
  if (!can(role, "empreendimentos.view")) redirect("/brief");

  const { id } = await params;
  const sp = await searchParams;
  const activeTab: Tab =
    sp?.tab && TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "visao";

  const sb = supabaseAdmin();
  const [empRes, faqsRes, matrix, summary] = await Promise.all([
    sb.from("empreendimentos").select("*").eq("id", id).maybeSingle(),
    sb
      .from("empreendimento_faqs")
      .select("*")
      .eq("empreendimento_id", id)
      .order("created_at", { ascending: false }),
    getUnidadesMatrix(id),
    getUnidadesSummary(id),
  ]);

  if (empRes.error || !empRes.data) notFound();
  const emp = empRes.data as Empreendimento;
  const faqs = (faqsRes.data ?? []) as Faq[];

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Empreendimentos", href: "/empreendimentos" },
          { label: emp.nome },
        ]}
      />
      <main className="page-body detail-page">
        <header className="detail-head">
          <div>
            <h1 className="display">{emp.nome}</h1>
            <p className="detail-sub">
              {[emp.construtora, emp.bairro, emp.cidade].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="detail-head-meta">
            {summary.total > 0 ? (
              <div className="meta-pill">
                <span className="meta-n">{summary.avail}</span>
                <span className="meta-l">disponíveis</span>
              </div>
            ) : null}
            {summary.total > 0 && formatPrecoRange(summary) ? (
              <div className="meta-pill">
                <span className="meta-n">{formatPrecoRange(summary)}</span>
              </div>
            ) : null}
          </div>
        </header>

        <nav className="detail-tabs" role="tablist">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/empreendimentos/${id}?tab=${t.key}`}
              className={`detail-tab ${activeTab === t.key ? "on" : ""}`}
              role="tab"
              aria-selected={activeTab === t.key}
            >
              {t.label}
              {t.key === "unidades" && summary.total > 0 ? (
                <span className="tab-count">{summary.total}</span>
              ) : null}
              {t.key === "faqs" && faqs.length > 0 ? (
                <span className="tab-count">{faqs.length}</span>
              ) : null}
              {t.key === "tipologias" && emp.tipologias?.length > 0 ? (
                <span className="tab-count">{emp.tipologias.length}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        {activeTab === "visao" ? <VisaoTab emp={emp} /> : null}
        {activeTab === "tipologias" ? <TipologiasTab emp={emp} /> : null}
        {activeTab === "unidades" ? (
          <UnidadesTab empId={emp.id} matrix={matrix} summary={summary} canEdit={can(role, "empreendimentos.edit")} />
        ) : null}
        {activeTab === "faqs" ? <FaqsTab empId={emp.id} faqs={faqs} /> : null}
        {activeTab === "docs" ? <DocsTab emp={emp} /> : null}
      </main>
    </>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────

function VisaoTab({ emp }: { emp: Empreendimento }) {
  return (
    <section className="tab-body">
      <div className="detail-grid">
        <div className="detail-panel">
          <h3>Informações</h3>
          <dl className="detail-kv">
            <Kv k="Construtora" v={emp.construtora} />
            <Kv k="Status" v={emp.status} />
            <Kv k="Endereço" v={emp.endereco} />
            <Kv k="Bairro" v={emp.bairro} />
            <Kv k="Cidade" v={emp.cidade} />
            <Kv k="Estado" v={emp.estado} />
            <Kv k="Entrega" v={emp.entrega} />
            <Kv
              k="Preço inicial"
              v={
                emp.preco_inicial
                  ? emp.preco_inicial.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      maximumFractionDigits: 0,
                    })
                  : null
              }
            />
          </dl>
        </div>

        {emp.descricao ? (
          <div className="detail-panel">
            <h3>Descrição</h3>
            <p className="detail-desc">{emp.descricao}</p>
          </div>
        ) : null}

        {emp.diferenciais?.length > 0 ? (
          <div className="detail-panel">
            <h3>Diferenciais</h3>
            <ul className="detail-tags">
              {emp.diferenciais.map((d, i) => (
                <li key={i} className="tag-pill">{d}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {emp.lazer?.length > 0 ? (
          <div className="detail-panel">
            <h3>Lazer</h3>
            <ul className="detail-tags">
              {emp.lazer.map((d, i) => (
                <li key={i} className="tag-pill">{d}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TipologiasTab({ emp }: { emp: Empreendimento }) {
  if (!emp.tipologias || emp.tipologias.length === 0) {
    return <div className="empty-sm">Nenhuma tipologia cadastrada.</div>;
  }
  return (
    <section className="tab-body">
      <div className="typ-cards">
        {emp.tipologias.map((t, i) => (
          <div key={i} className="typ-card">
            <div className="typ-card-head">
              {t.quartos != null ? `${t.quartos} quartos` : "Tipologia"}
              {t.suites != null ? (
                <span className="typ-sub"> · {t.suites} suíte{t.suites > 1 ? "s" : ""}</span>
              ) : null}
            </div>
            <dl className="typ-kv">
              <Kv k="Área" v={t.area != null ? `${t.area}m²` : null} />
              <Kv k="Vagas" v={t.vagas != null ? String(t.vagas) : null} />
              <Kv
                k="Preço"
                v={
                  t.preco != null
                    ? t.preco.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                        maximumFractionDigits: 0,
                      })
                    : null
                }
              />
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function UnidadesTab({
  empId,
  matrix,
  summary,
  canEdit,
}: {
  empId: string;
  matrix: Awaited<ReturnType<typeof getUnidadesMatrix>>;
  summary: Awaited<ReturnType<typeof getUnidadesSummary>>;
  canEdit: boolean;
}) {
  return (
    <section className="tab-body">
      <div className="unid-summary">
        <div className="unid-sum-card">
          <div className="sum-n">{summary.total}</div>
          <div className="sum-l">Total</div>
        </div>
        <div className="unid-sum-card tone-ok">
          <div className="sum-n">{summary.avail}</div>
          <div className="sum-l">Disponíveis</div>
        </div>
        <div className="unid-sum-card tone-warn">
          <div className="sum-n">{summary.reserved}</div>
          <div className="sum-l">Reservadas</div>
        </div>
        <div className="unid-sum-card">
          <div className="sum-n">{summary.sold}</div>
          <div className="sum-l">Vendidas</div>
        </div>
      </div>

      {matrix.length === 0 ? (
        <div className="empty-sm">
          Nenhuma unidade cadastrada.
          {canEdit ? (
            <> Vá em <Link href={`/admin/empreendimentos`}>/admin/empreendimentos</Link> pra adicionar.</>
          ) : null}
        </div>
      ) : (
        <div className="unid-matrix">
          {matrix.map((row) => (
            <div key={row.andar} className="unid-floor">
              <div className="unid-floor-label">
                <span className="floor-n">{row.andar}</span>
                <span className="floor-l">andar</span>
              </div>
              <div className="unid-floor-cells">
                {row.unidades.map((u) => (
                  <div
                    key={u.id}
                    className={`unid-cell status-${u.status}`}
                    title={`${u.numero} · ${UNIDADE_STATUS_LABEL[u.status]}${u.preco ? ` · ${u.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}` : ""}`}
                  >
                    <div className="cell-num">{u.numero}</div>
                    {u.tipologia_ref ? (
                      <div className="cell-typ">{u.tipologia_ref}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="unid-legend">
        <span><span className="dot status-avail" /> Disponível</span>
        <span><span className="dot status-reserved" /> Reservada</span>
        <span><span className="dot status-sold" /> Vendida</span>
        <span><span className="dot status-unavailable" /> Indisponível</span>
      </div>

      {/* empId é reservado pra futuras ações inline (ex: editar status via modal). */}
      <input type="hidden" name="emp-id" value={empId} />
    </section>
  );
}

function FaqsTab({ empId, faqs }: { empId: string; faqs: Faq[] }) {
  if (faqs.length === 0) {
    return (
      <div className="empty-sm">
        Nenhuma FAQ ainda. Corretor pode promover perguntas pelo /handoff ao
        avaliar uma escalação.
      </div>
    );
  }
  return (
    <section className="tab-body">
      <div className="faq-list">
        {faqs.map((f) => (
          <article key={f.id} className="faq-card">
            <div className="faq-q">{f.question}</div>
            <div className="faq-a">{f.answer}</div>
            <div className="faq-meta">
              <span className={`faq-source ${f.source}`}>{f.source === "manual" ? "manual" : "IA"}</span>
              <span>{new Date(f.updated_at).toLocaleDateString("pt-BR")}</span>
            </div>
          </article>
        ))}
      </div>
      <input type="hidden" name="emp-id" value={empId} />
    </section>
  );
}

function DocsTab({ emp }: { emp: Empreendimento }) {
  const midias = emp.midias ?? [];
  const chunks = emp.raw_knowledge ?? [];
  return (
    <section className="tab-body">
      <div className="detail-panel">
        <h3>Arquivos</h3>
        {midias.length === 0 ? (
          <div className="empty-sm">Nenhum arquivo.</div>
        ) : (
          <ul className="docs-list">
            {midias.map((m, i) => (
              <li key={i} className="docs-row">
                <span className={`docs-icon type-${m.type}`}>{docIcon(m.type)}</span>
                <span className="docs-name">{m.name}</span>
                <span className="docs-size">{fmtSize(m.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-panel">
        <h3>Conhecimento extraído</h3>
        <p className="panel-sub">
          Chunks que a Bia consulta via RAG. Extraídos do Claude no upload.
        </p>
        {chunks.length === 0 ? (
          <div className="empty-sm">Nenhum conhecimento extraído.</div>
        ) : (
          <ul className="chunks-list">
            {chunks.slice(0, 30).map((c, i) => (
              <li key={i} className="chunk">
                <div className="chunk-sec">{c.section}</div>
                <div className="chunk-text">{c.text}</div>
                <div className="chunk-source">{c.source_file}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function Kv({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function docIcon(type: string): string {
  switch (type) {
    case "pdf":
      return "📄";
    case "sheet":
      return "📊";
    case "image":
      return "🖼";
    default:
      return "📎";
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
