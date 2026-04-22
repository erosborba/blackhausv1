import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { getSession } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase";
import { Timeline } from "@/components/inbox/Timeline";
import { Avatar } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chip";
import { HANDOFF_REASON_LABEL, HANDOFF_URGENCY_EMOJI } from "@/lib/handoff-copy";
import type { Lead } from "@/lib/leads";
import "./leads.css";

export const dynamic = "force-dynamic";

/**
 * /leads/[id] — perfil completo do lead.
 *
 * Endpoint "profundo" — quando o corretor precisa de mais contexto do
 * que o ContextRail (320px) do /inbox. Read-only na primeira versão;
 * edição de qualification/notes fica pra Tier 2.
 */
export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { agent } = await getSession();
  const role = agent?.role ?? "admin";
  if (role !== "admin" && role !== "corretor") redirect("/brief");

  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!leadRow) notFound();
  const lead = leadRow as Lead & {
    phone: string;
    agent_notes?: string | null;
    brief?: string | null;
    brief_at?: string | null;
    memory?: string | null;
    memory_updated_at?: string | null;
    created_at?: string;
    last_message_at?: string | null;
    email?: string | null;
  };

  const name = lead.full_name ?? lead.push_name ?? lead.phone;
  const score = lead.score ?? 0;
  const tone = score >= 70 ? "ok" : score >= 40 ? "warm" : "hot";
  const toneLabel = score >= 70 ? "forte" : score >= 40 ? "morno" : "frio";
  const q = (lead.qualification ?? {}) as Record<string, unknown>;

  const qEntries = Object.entries(q).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  const pendingHandoff =
    lead.handoff_notified_at != null &&
    !lead.bridge_active &&
    !lead.handoff_resolved_at;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Inbox", href: "/inbox" },
          { label: name },
        ]}
      />
      <main className="page-body lead-page">
        <div className="lead-wrap">
          {/* Hero */}
          <header className="lead-hero">
            <div className="lead-hero-main">
              <Avatar name={name} size="lg" />
              <div className="lead-hero-who">
                <h1>{name}</h1>
                <div className="lead-hero-sub">
                  <span>{lead.phone}</span>
                  {lead.email ? <span>{lead.email}</span> : null}
                  {lead.status ? <Chip tone="ghost">{lead.status}</Chip> : null}
                  {lead.stage ? <Chip tone="ghost">{lead.stage}</Chip> : null}
                  {lead.human_takeover ? (
                    <Chip tone="ok" dot>
                      Corretor ativo
                    </Chip>
                  ) : (
                    <Chip tone="warm" dot>
                      IA atendendo
                    </Chip>
                  )}
                </div>
              </div>
            </div>
            <div className="lead-hero-actions">
              <Link href={`/inbox/${lead.id}`} className="btn blue sm">
                Abrir no inbox →
              </Link>
              <Link href={`/agenda?lead=${lead.id}`} className="btn sm">
                Agendar visita
              </Link>
              {pendingHandoff ? (
                <Link href={`/handoff/${lead.id}`} className="btn sm">
                  Revisar handoff
                </Link>
              ) : null}
            </div>
          </header>

          {/* Grid */}
          <div className="lead-grid">
            {/* Coluna esquerda */}
            <section className="lead-col">
              {/* Radar */}
              <div className="lead-card">
                <h3 className="lead-card-title">Radar</h3>
                <div className="lead-radar">
                  <div className="lead-radar-num">
                    <div className="num" style={{ color: `var(--${tone})` }}>
                      {score}
                    </div>
                    <div className="slash">/100</div>
                  </div>
                  <div className="lead-radar-meter">
                    <div className="meter">
                      <span className={tone} style={{ width: `${score}%` }} />
                    </div>
                    <div className="mono">
                      score · {toneLabel}
                      {lead.score_updated_at
                        ? ` · atualizado ${fmtRel(lead.score_updated_at)}`
                        : ""}
                    </div>
                  </div>
                </div>
              </div>

              {/* Brief */}
              {lead.brief ? (
                <div className="lead-card">
                  <h3 className="lead-card-title">
                    Brief da Bia
                    {lead.brief_at ? (
                      <span className="hint">· {fmtRel(lead.brief_at)}</span>
                    ) : null}
                  </h3>
                  <p className="lead-brief">{lead.brief}</p>
                </div>
              ) : null}

              {/* Qualificação */}
              <div className="lead-card">
                <h3 className="lead-card-title">Qualificação</h3>
                {qEntries.length === 0 ? (
                  <div className="lead-empty">
                    Ainda não qualificado. A Bia vai preencher conforme a conversa
                    avança.
                  </div>
                ) : (
                  <dl className="lead-kv">
                    {qEntries.map(([k, v]) => (
                      <div key={k} className="lead-kv-row">
                        <dt>{k}</dt>
                        <dd>{renderValue(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              {/* Notas do corretor */}
              {lead.agent_notes ? (
                <div className="lead-card">
                  <h3 className="lead-card-title">Notas do corretor</h3>
                  <p className="lead-notes">{lead.agent_notes}</p>
                </div>
              ) : null}

              {/* Memória da IA */}
              {lead.memory && lead.memory.trim().length > 0 ? (
                <div className="lead-card">
                  <h3 className="lead-card-title">
                    Memória da Bia
                    {lead.memory_updated_at ? (
                      <span className="hint">· {fmtRel(lead.memory_updated_at)}</span>
                    ) : null}
                  </h3>
                  <p className="lead-brief">{lead.memory}</p>
                </div>
              ) : null}
            </section>

            {/* Coluna direita */}
            <aside className="lead-col">
              {/* Handoff pendente */}
              {pendingHandoff ? (
                <div className="lead-card lead-card-warn">
                  <h3 className="lead-card-title">Handoff pendente</h3>
                  <div className="lead-handoff">
                    <span className="emoji">
                      {lead.handoff_urgency
                        ? HANDOFF_URGENCY_EMOJI[lead.handoff_urgency]
                        : "🔔"}
                    </span>
                    <div>
                      <strong>
                        {lead.handoff_reason
                          ? HANDOFF_REASON_LABEL[lead.handoff_reason] ??
                            lead.handoff_reason
                          : "handoff"}
                      </strong>
                      {lead.handoff_urgency ? (
                        <span className="muted"> · urgência {lead.handoff_urgency}</span>
                      ) : null}
                    </div>
                  </div>
                  <Link href={`/handoff/${lead.id}`} className="btn sm">
                    Revisar handoff →
                  </Link>
                </div>
              ) : null}

              {/* Ações */}
              <div className="lead-card">
                <h3 className="lead-card-title">Ações</h3>
                <div className="lead-actions">
                  <Link href={`/inbox/${lead.id}`} className="btn sm">
                    Abrir conversa
                    <span className="kbd">↵</span>
                  </Link>
                  <Link href={`/agenda?lead=${lead.id}`} className="btn sm">
                    Agendar visita
                    <span className="kbd">⌘V</span>
                  </Link>
                </div>
              </div>

              {/* Timeline */}
              <div className="lead-card">
                <h3 className="lead-card-title">Histórico de eventos</h3>
                <Timeline leadId={lead.id} />
              </div>

              {/* Metadados */}
              <div className="lead-card lead-card-meta">
                <dl className="lead-kv">
                  {lead.created_at ? (
                    <div className="lead-kv-row">
                      <dt>Criado</dt>
                      <dd>{fmtDate(lead.created_at)}</dd>
                    </div>
                  ) : null}
                  {lead.last_message_at ? (
                    <div className="lead-kv-row">
                      <dt>Última msg</dt>
                      <dd>{fmtRel(lead.last_message_at)}</dd>
                    </div>
                  ) : null}
                  <div className="lead-kv-row">
                    <dt>ID</dt>
                    <dd className="mono small">{lead.id}</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}

function renderValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number" && v >= 1000)
    return v >= 1_000_000
      ? `R$ ${(v / 1_000_000).toFixed(1)}M`
      : `R$ ${(v / 1_000).toFixed(0)}k`;
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
