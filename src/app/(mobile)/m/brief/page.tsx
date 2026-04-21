import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/auth/role-server";
import { getPanorama, type ActionItem, type PanoramaKPI } from "@/lib/brief-panorama";
import { HANDOFF_URGENCY_EMOJI } from "@/lib/handoff-copy";

export const dynamic = "force-dynamic";

/**
 * /m/brief — versão mobile do cockpit. KPIs compactados em grade 2x,
 * lista vertical de ações. Handoffs levam a /handoff/[id] (mesma rota
 * desktop — ainda não tem versão mobile dedicada, cabe OK).
 */
export default async function MobileBriefPage() {
  const role = await getCurrentRole();
  if (role !== "admin" && role !== "corretor") redirect("/m/inbox");

  const { kpi, actions } = await getPanorama();

  return (
    <>
      <h1 className="m-page-title">{pickGreeting()}</h1>
      <p className="m-page-sub">{makeNarrative(kpi)}</p>

      <section aria-label="Resumo do dia">
        <div className="m-kpi-grid">
          <Kpi label="Handoff" value={kpi.handoff_pendente} hint="pendentes" tone={kpi.handoff_pendente > 0 ? "hot" : "neutral"} />
          <Kpi label="Quentes" value={kpi.leads_quentes} hint="score ≥ 80" tone={kpi.leads_quentes > 0 ? "warm" : "neutral"} />
          <Kpi label="Novos 24h" value={kpi.novos_hoje} hint="entraram hoje" tone="neutral" />
          <Kpi label="Follow-ups" value={kpi.follow_ups_devidos} hint="próximo tick" tone="neutral" />
        </div>
      </section>

      <section aria-label="Próximas ações">
        <h2 className="m-agenda-section-h">Próximas ações</h2>
        {actions.length === 0 ? (
          <div className="m-empty">
            <div className="m-empty-title">Tudo em dia</div>
            Nada urgente pra revisar agora.
          </div>
        ) : (
          <div className="m-actions">
            {actions.slice(0, 10).map((a) => (
              <Action key={a.id} a={a} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "hot" | "warm" | "neutral";
}) {
  return (
    <div className={`m-kpi tone-${tone}`}>
      <div className="m-kpi-label">{label}</div>
      <div className="m-kpi-value">{value}</div>
      <div className="m-kpi-hint">{hint}</div>
    </div>
  );
}

function Action({ a }: { a: ActionItem }) {
  const href = a.handoff_pending ? `/handoff/${a.id}` : `/m/inbox/${a.id}`;
  const urgency = a.handoff_urgency ? HANDOFF_URGENCY_EMOJI[a.handoff_urgency] : null;
  return (
    <Link href={href} className="m-action">
      <div className="m-action-top">
        <span className={`m-action-kind kind-${a.priority_kind}`}>
          {urgency ?? kindEmoji(a.priority_kind)} {kindLabel(a.priority_kind)}
        </span>
        <span className="m-action-score">{a.score}</span>
      </div>
      <div className="m-action-name">{a.name}</div>
      <div className="m-action-sub">
        {a.phone}
        {a.stage ? ` · ${a.stage}` : ""}
      </div>
      {a.last_message_snippet ? (
        <div className="m-action-snippet">“{a.last_message_snippet}”</div>
      ) : null}
    </Link>
  );
}

function pickGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Bia em vigília";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function makeNarrative(kpi: PanoramaKPI): string {
  if (kpi.handoff_pendente > 0) return `${kpi.handoff_pendente} handoff pendente${kpi.handoff_pendente > 1 ? "s" : ""} — abre primeiro.`;
  if (kpi.leads_quentes > 0) return `${kpi.leads_quentes} lead${kpi.leads_quentes > 1 ? "s" : ""} quente${kpi.leads_quentes > 1 ? "s" : ""} esperando.`;
  if (kpi.follow_ups_devidos > 0) return `${kpi.follow_ups_devidos} follow-up${kpi.follow_ups_devidos > 1 ? "s" : ""} no próximo tick.`;
  if (kpi.novos_hoje > 0) return `${kpi.novos_hoje} lead${kpi.novos_hoje > 1 ? "s" : ""} novo${kpi.novos_hoje > 1 ? "s" : ""} em 24h.`;
  return "Tudo respirando. Bom momento pra revisar.";
}

function kindLabel(k: ActionItem["priority_kind"]): string {
  return { handoff: "Handoff", hot: "Quente", follow_up: "Follow-up", new: "Novo" }[k];
}
function kindEmoji(k: ActionItem["priority_kind"]): string {
  return { handoff: "🚨", hot: "🔥", follow_up: "⏰", new: "✨" }[k];
}
