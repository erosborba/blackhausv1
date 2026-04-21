import { redirect } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { getCurrentRole } from "@/lib/auth/role-server";
import { getPanorama, type ActionItem, type PanoramaKPI } from "@/lib/brief-panorama";
import {
  HANDOFF_REASON_LABEL,
  HANDOFF_URGENCY_EMOJI,
} from "@/lib/handoff-copy";
import "./brief.css";

export const dynamic = "force-dynamic";

/**
 * /brief — cockpit do dia.
 *
 * Server-rendered: 4 KPI cards + lista de ação (top 10 leads por
 * prioridade handoff > quente > follow-up > novo). Cada card é clicável e
 * leva pra /inbox/[id] ou /handoff/[id] dependendo da natureza.
 *
 * Diferente do /inbox: o /brief é narrativa (o que fazer agora), /inbox
 * é workspace (thread + contexto).
 */
export default async function BriefPage() {
  const role = await getCurrentRole();
  if (role !== "admin" && role !== "corretor") redirect("/inbox");

  const { kpi, actions } = await getPanorama();
  const greeting = pickGreeting();

  return (
    <>
      <Topbar crumbs={[{ label: "Brief do dia" }]} />
      <main className="page-body brief-page">
        <div className="brief-wrap">
          <header className="brief-head">
            <h1 className="display">{greeting}</h1>
            <p className="brief-intro">
              {makeNarrative(kpi)}
            </p>
          </header>

          <section className="kpi-row" aria-label="Resumo do dia">
            <KpiCard
              label="Leads ativos"
              value={kpi.total_ativos}
              hint="Fora de won/lost"
              tone="neutral"
            />
            <KpiCard
              label="Novos em 24h"
              value={kpi.novos_hoje}
              hint="Entraram hoje"
              tone="cool"
            />
            <KpiCard
              label="Handoff pendente"
              value={kpi.handoff_pendente}
              hint="Bia escalou, corretor ainda não abriu a ponte"
              tone={kpi.handoff_pendente > 0 ? "hot" : "neutral"}
            />
            <KpiCard
              label="Leads quentes"
              value={kpi.leads_quentes}
              hint="Score ≥ 80"
              tone="warm"
            />
            <KpiCard
              label="Follow-ups devidos"
              value={kpi.follow_ups_devidos}
              hint="Cron vai disparar no próximo tick"
              tone={kpi.follow_ups_devidos > 0 ? "warm" : "neutral"}
            />
          </section>

          <section className="actions-section">
            <h2 className="section-h">Próximas ações</h2>
            {actions.length === 0 ? (
              <div className="empty-state">
                Tudo em dia — nada urgente pra revisar agora.
              </div>
            ) : (
              <div className="action-grid">
                {actions.map((a) => (
                  <ActionCard key={a.id} a={a} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

// ── UI atoms ──────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "hot" | "warm" | "cool" | "neutral";
}) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-hint">{hint}</div>
    </div>
  );
}

function ActionCard({ a }: { a: ActionItem }) {
  const href = a.handoff_pending ? `/handoff/${a.id}` : `/inbox/${a.id}`;
  const kindLabel = kindCopy(a.priority_kind);
  const urgencyEmoji = a.handoff_urgency
    ? HANDOFF_URGENCY_EMOJI[a.handoff_urgency]
    : null;
  const reasonLabel = a.handoff_reason
    ? HANDOFF_REASON_LABEL[
        a.handoff_reason as keyof typeof HANDOFF_REASON_LABEL
      ]
    : null;

  return (
    <Link href={href} className={`action-card kind-${a.priority_kind}`}>
      <div className="action-top">
        <span className={`kind-badge kind-${a.priority_kind}`}>
          {urgencyEmoji ?? kindEmoji(a.priority_kind)} {kindLabel}
        </span>
        <span className="score">{a.score}</span>
      </div>
      <div className="action-name">{a.name}</div>
      <div className="action-sub">
        {a.phone}
        {a.stage ? ` · ${a.stage}` : ""}
      </div>
      {a.last_message_snippet ? (
        <div className="action-snippet">"{a.last_message_snippet}"</div>
      ) : null}
      {a.handoff_pending && reasonLabel ? (
        <div className="action-reason">{reasonLabel}</div>
      ) : null}
      <div className="action-cta">
        {a.handoff_pending ? "Revisar handoff →" : "Abrir thread →"}
      </div>
    </Link>
  );
}

// ── copy helpers ──────────────────────────────────────────────────────────

function pickGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Bia ainda vigília";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function makeNarrative(kpi: PanoramaKPI): string {
  const parts: string[] = [];
  if (kpi.handoff_pendente > 0) {
    parts.push(
      `${kpi.handoff_pendente} handoff${kpi.handoff_pendente > 1 ? "s" : ""} pendente${kpi.handoff_pendente > 1 ? "s" : ""} — abre primeiro.`,
    );
  }
  if (kpi.leads_quentes > 0) {
    parts.push(
      `${kpi.leads_quentes} lead${kpi.leads_quentes > 1 ? "s" : ""} quente${kpi.leads_quentes > 1 ? "s" : ""} esperando.`,
    );
  }
  if (kpi.follow_ups_devidos > 0) {
    parts.push(`${kpi.follow_ups_devidos} follow-up${kpi.follow_ups_devidos > 1 ? "s" : ""} disparam no próximo tick.`);
  }
  if (kpi.novos_hoje > 0 && parts.length === 0) {
    parts.push(`${kpi.novos_hoje} lead${kpi.novos_hoje > 1 ? "s" : ""} nov${kpi.novos_hoje > 1 ? "os" : "o"} em 24h.`);
  }
  if (parts.length === 0) {
    return "Tudo respirando. Bom momento pra revisar FAQs ou empreendimentos.";
  }
  return parts.join(" ");
}

function kindCopy(k: ActionItem["priority_kind"]): string {
  return {
    handoff: "Handoff",
    hot: "Quente",
    follow_up: "Follow-up",
    new: "Novo",
  }[k];
}

function kindEmoji(k: ActionItem["priority_kind"]): string {
  return {
    handoff: "🚨",
    hot: "🔥",
    follow_up: "⏰",
    new: "✨",
  }[k];
}
