import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { getCurrentRole } from "@/lib/auth/role-server";
import { getSession } from "@/lib/auth/session";
import { getPanorama, type ActionItem, type PanoramaKPI } from "@/lib/brief-panorama";
import {
  HANDOFF_REASON_LABEL,
} from "@/lib/handoff-copy";
import "./brief.css";

export const dynamic = "force-dynamic";

/**
 * /brief — cockpit do dia (Daily Brief).
 *
 * Layout 1:1 com hifi/index.html:
 *   - Hero: saudação + narrativa + 3 stat cards à direita
 *   - Grid 1.5fr/1fr: coluna esquerda com decision-cards, coluna direita
 *     com widgets (Próximos contatos + Pulso operacional).
 *
 * Data-driven: puxa `getPanorama()` (inbox_items + follow_ups) e converte
 * pras views visuais. Nada de LLM aqui — a narrativa por lead continua
 * em /inbox/[id].
 */
export default async function BriefPage() {
  const role = await getCurrentRole();
  if (role !== "admin" && role !== "corretor") redirect("/inbox");

  const [{ kpi, actions }, { agent }] = await Promise.all([
    getPanorama(),
    getSession(),
  ]);

  const greeting = pickGreeting();
  const firstName = (agent?.name || "").split(/\s+/)[0] || "";
  const dateLabel = formatDateLabel();
  const periodLabel = pickPeriodLabel();

  return (
    <>
      <Topbar crumbs={[{ label: periodLabel }, { label: dateLabel }]} />
      <main className="page-body brief-page">
        <div className="brief-wrap">

          <div className="brief-hero">
            <div className="brief-hero-left">
              <div className="brief-hello">
                {greeting}{firstName ? `, ${firstName}` : ""}.
              </div>
              <div className="brief-sub">{makeNarrative(kpi)}</div>
            </div>
            <div className="brief-stats">
              <div className="brief-stat">
                <span className="lbl">Novos em 24h</span>
                <span className="val">{kpi.novos_hoje}</span>
              </div>
              <div className="brief-stat">
                <span className="lbl">Handoff pendente</span>
                <span className="val" style={{ color: kpi.handoff_pendente > 0 ? "var(--hot)" : undefined }}>
                  {kpi.handoff_pendente}
                </span>
              </div>
              <div className="brief-stat">
                <span className="lbl">Leads quentes</span>
                <span className="val">{kpi.leads_quentes}</span>
              </div>
            </div>
          </div>

          <div className="brief-grid">

            {/* Coluna esquerda — decisões */}
            <section className="brief-col brief-col-decisions">
              <header className="brief-col-head">
                <h2 className="brief-col-title">Preciso da sua decisão</h2>
                {actions.length > 0 ? (
                  <span className={`chip ${kpi.handoff_pendente > 0 ? "hot" : "ghost"}`}>
                    <span className="dot" />
                    {actions.length} {actions.length === 1 ? "pendente" : "pendentes"}
                  </span>
                ) : (
                  <span className="chip ok"><span className="dot" />tudo em dia</span>
                )}
              </header>

              {actions.length === 0 ? (
                <div className="brief-empty">
                  Tudo respirando. Bom momento pra revisar FAQs ou atualizar o
                  book comercial dos empreendimentos.
                </div>
              ) : (
                actions.map((a, i) => (
                  <DecisionCard key={a.id} a={a} urgent={i === 0 && isUrgent(a)} />
                ))
              )}
            </section>

            {/* Coluna direita — widgets */}
            <aside className="brief-col brief-col-widgets">
              <div className="widget">
                <h3>
                  Agenda · hoje
                  <Link href="/agenda" className="widget-link">abrir agenda →</Link>
                </h3>
                <div className="widget-empty-block">
                  <div className="widget-empty-title">Nenhuma visita marcada pra hoje.</div>
                  <div className="widget-empty-sub">
                    Quando a Bia agendar uma visita ou call, vai aparecer aqui com
                    horário, cliente e confirmação.
                  </div>
                </div>
              </div>

              <div className="widget">
                <h3>
                  O que a IA fez nas últimas 12h
                  <span className="hint">em breve</span>
                </h3>
                <div className="widget-empty-block">
                  <div className="widget-empty-title">Timeline ainda não integrada.</div>
                  <div className="widget-empty-sub">
                    Vai listar conversas atendidas, visitas agendadas, tabelas enviadas,
                    follow-ups disparados e escaladas — tudo do turno.
                  </div>
                </div>
              </div>

              <div className="widget widget-pulse">
                <h3 style={{ color: "var(--blue-ink)" }}>Pulso do dia</h3>
                <div className="widget-pulse-grid">
                  <div>
                    <div className="mono">NOVOS</div>
                    <div className="widget-pulse-val">
                      {kpi.novos_hoje}
                      {kpi.novos_hoje > 0 ? (
                        <span className="xs" style={{ color: "var(--ok)", fontWeight: 500 }}>
                          {" "}▲
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="mono">ESCALADOS</div>
                    <div
                      className="widget-pulse-val"
                      style={{ color: kpi.handoff_pendente > 0 ? "var(--hot)" : undefined }}
                    >
                      {kpi.handoff_pendente}
                    </div>
                  </div>
                  <div>
                    <div className="mono">FOLLOW-UP</div>
                    <div
                      className="widget-pulse-val"
                      style={{ color: kpi.follow_ups_devidos > 0 ? "var(--warm)" : undefined }}
                    >
                      {kpi.follow_ups_devidos}
                    </div>
                  </div>
                </div>
              </div>
            </aside>

          </div>
        </div>
      </main>
    </>
  );
}

// ── UI atoms ──────────────────────────────────────────────────────────────

function DecisionCard({ a, urgent }: { a: ActionItem; urgent: boolean }) {
  const href = a.handoff_pending ? `/handoff/${a.id}` : `/inbox/${a.id}`;
  const headChip = headerChip(a);
  const reasonLabel = a.handoff_reason
    ? HANDOFF_REASON_LABEL[a.handoff_reason as keyof typeof HANDOFF_REASON_LABEL]
    : null;
  const timeSince = a.last_message_at ? timeAgo(a.last_message_at) : null;

  return (
    <article className={`decision-card${urgent ? " urgent" : ""}`}>
      <div className="head">
        <span className={`chip ${headChip.tone}`}>
          {headChip.label}
        </span>
        {reasonLabel ? (
          <span className="chip ghost">{reasonLabel}</span>
        ) : null}
        <span className="score-pill">score {a.score}</span>
        {timeSince ? (
          <span className="xs muted" style={{ marginLeft: "auto" }}>{timeSince}</span>
        ) : null}
      </div>
      <div className="body">
        <strong>{a.name}</strong>
        {" "}
        {bodyText(a)}
      </div>
      {a.last_message_snippet ? (
        <div className="quote">&ldquo;{a.last_message_snippet}&rdquo;</div>
      ) : null}
      <div className="actions">
        <Link href={href} className="btn blue sm">
          {a.handoff_pending ? "Revisar handoff" : "Abrir conversa"}
        </Link>
        {a.handoff_pending ? (
          <Link href={`/inbox/${a.id}`} className="btn ghost sm">
            Ver thread →
          </Link>
        ) : null}
      </div>
    </article>
  );
}

// ── copy helpers ──────────────────────────────────────────────────────────

function pickGreeting(): string {
  const h = new Date().getHours();
  // Madrugada não existe como saudação — quem tá ligado 2h da manhã
  // quer "Bom dia" mesmo.
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function pickPeriodLabel(): string {
  const h = new Date().getHours();
  if (h < 12) return "Manhã";
  if (h < 18) return "Tarde";
  return "Noite";
}

const WEEKDAYS_FULL = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];
const MONTHS_FULL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function formatDateLabel(): string {
  const d = new Date();
  return `${WEEKDAYS_FULL[d.getDay()]} - ${d.getDate()} de ${MONTHS_FULL[d.getMonth()]}`;
}

function makeNarrative(kpi: PanoramaKPI): string {
  const parts: string[] = [];
  if (kpi.handoff_pendente > 0) {
    parts.push(
      `${kpi.handoff_pendente} handoff${kpi.handoff_pendente > 1 ? "s" : ""} esperando decisão`,
    );
  }
  if (kpi.leads_quentes > 0) {
    parts.push(
      `${kpi.leads_quentes} lead${kpi.leads_quentes > 1 ? "s" : ""} quente${kpi.leads_quentes > 1 ? "s" : ""}`,
    );
  }
  if (kpi.follow_ups_devidos > 0) {
    parts.push(
      `${kpi.follow_ups_devidos} follow-up${kpi.follow_ups_devidos > 1 ? "s" : ""} no próximo tick`,
    );
  }
  if (parts.length === 0) {
    if (kpi.novos_hoje > 0) {
      return `Enquanto você estava fora a IA conversou com ${kpi.novos_hoje} lead${kpi.novos_hoje > 1 ? "s" : ""} novo${kpi.novos_hoje > 1 ? "s" : ""} e não precisou escalar nada. Tudo sob controle.`;
    }
    return "Tudo respirando. Bom momento pra revisar FAQs ou atualizar o book dos empreendimentos.";
  }
  const base = kpi.novos_hoje > 0
    ? `Em 24h chegaram ${kpi.novos_hoje} lead${kpi.novos_hoje > 1 ? "s" : ""} novo${kpi.novos_hoje > 1 ? "s" : ""}. `
    : "";
  return `${base}${parts.join(", ")}.`;
}

function headerChip(a: ActionItem): { label: string; tone: string } {
  if (a.priority_kind === "handoff") {
    return a.handoff_urgency === "alta"
      ? { label: "HANDOFF URGENTE", tone: "hot" }
      : { label: "HANDOFF", tone: "hot" };
  }
  if (a.priority_kind === "hot") return { label: "LEAD QUENTE", tone: "warm" };
  if (a.priority_kind === "follow_up") return { label: "FOLLOW-UP", tone: "warm" };
  return { label: "NOVO LEAD", tone: "blue-soft" };
}

function bodyText(a: ActionItem): string {
  if (a.priority_kind === "handoff") {
    return a.handoff_urgency === "alta"
      ? "escalou com urgência alta. A Bia segurou e está esperando você abrir a ponte."
      : "foi escalado pra corretor humano — a Bia identificou que a conversa precisa da sua decisão.";
  }
  if (a.priority_kind === "hot") {
    return `tá com score ${a.score} — lead quente esperando próximo toque.`;
  }
  if (a.priority_kind === "follow_up") {
    return "tem follow-up programado. Próximo tick do cron vai disparar.";
  }
  return "é um lead novo das últimas 24h. Bia já fez a primeira abordagem.";
}

function isUrgent(a: ActionItem): boolean {
  return a.priority_kind === "handoff" && a.handoff_urgency === "alta";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
