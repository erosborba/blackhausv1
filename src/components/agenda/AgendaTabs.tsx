"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { FollowUpRowData, AgendaTab } from "./types";
import type { VisitWithContext } from "@/lib/visits";
import { VISIT_STATUS_LABEL, VISIT_STATUS_TONE } from "@/lib/visits";

const TABS: { key: AgendaTab; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "follow-ups", label: "Follow-ups" },
  { key: "visitas", label: "Visitas" },
];

export function AgendaTabs({
  tab,
  visitsDay,
  pendingFu,
  sentFu,
  visitsWeek,
  dayIso,
}: {
  tab: AgendaTab;
  visitsDay: VisitWithContext[];
  pendingFu: FollowUpRowData[];
  sentFu: FollowUpRowData[];
  visitsWeek: VisitWithContext[];
  dayIso: string;
}) {
  return (
    <>
      <nav className="agenda-tabs" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/agenda?tab=${t.key}&day=${dayIso}`}
            className={`agenda-tab ${t.key === tab ? "on" : ""}`}
            role="tab"
            aria-selected={t.key === tab}
          >
            {t.label}
            {t.key === "hoje" ? (
              <span className="agenda-tab-count">{visitsDay.length + pendingFu.length}</span>
            ) : null}
            {t.key === "follow-ups" ? (
              <span className="agenda-tab-count">{pendingFu.length}</span>
            ) : null}
            {t.key === "visitas" ? (
              <span className="agenda-tab-count">{visitsWeek.length}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {tab === "hoje" ? (
        <HojeTab visits={visitsDay} fu={pendingFu} />
      ) : tab === "follow-ups" ? (
        <FollowUpsTab pending={pendingFu} sent={sentFu} />
      ) : (
        <VisitasTab visits={visitsWeek} />
      )}
    </>
  );
}

// ── Aba: Hoje ───────────────────────────────────────────────────────────

function HojeTab({ visits, fu }: { visits: VisitWithContext[]; fu: FollowUpRowData[] }) {
  if (visits.length === 0 && fu.length === 0) {
    return (
      <div className="agenda-empty">
        <div className="empty-title">Dia tranquilo</div>
        <div className="empty-sub">Nenhuma visita ou follow-up pendente hoje.</div>
      </div>
    );
  }
  // Timeline cronológica combinando ambos.
  const items = [
    ...visits.map((v) => ({
      kind: "visit" as const,
      at: v.scheduled_at,
      node: <VisitItem v={v} />,
    })),
    ...fu.map((f) => ({
      kind: "fu" as const,
      at: f.scheduled_for,
      node: <FollowUpItem fu={f} />,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="agenda-timeline">
      {items.map((item, i) => (
        <div key={i} className="agenda-ev">
          <div className="agenda-ev-time">{fmtTime(item.at)}</div>
          <div className="agenda-ev-body">{item.node}</div>
        </div>
      ))}
    </div>
  );
}

// ── Aba: Follow-ups ─────────────────────────────────────────────────────

function FollowUpsTab({ pending, sent }: { pending: FollowUpRowData[]; sent: FollowUpRowData[] }) {
  return (
    <>
      <section className="agenda-section">
        <h2 className="section-h">Pendentes</h2>
        <p className="section-sub">
          Vão disparar na janela de envio (respeita anti-ban). {pending.length} agendado(s).
        </p>
        {pending.length === 0 ? (
          <div className="empty-sm">Nenhum pendente.</div>
        ) : (
          <ul className="agenda-list">
            {pending.map((f) => (
              <li key={f.id}><FollowUpItem fu={f} /></li>
            ))}
          </ul>
        )}
      </section>

      <section className="agenda-section">
        <h2 className="section-h">Histórico (30d)</h2>
        <p className="section-sub">Enviados, cancelados ou falhos.</p>
        {sent.length === 0 ? (
          <div className="empty-sm">Nada no histórico.</div>
        ) : (
          <ul className="agenda-list">
            {sent.slice(0, 30).map((f) => (
              <li key={f.id}><FollowUpItem fu={f} compact /></li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ── Aba: Visitas ────────────────────────────────────────────────────────

function VisitasTab({ visits }: { visits: VisitWithContext[] }) {
  const groups = useMemo(() => {
    const byDay = new Map<string, VisitWithContext[]>();
    for (const v of visits) {
      const key = new Date(v.scheduled_at).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(v);
    }
    return Array.from(byDay.entries()).sort(
      ([a], [b]) => parseBr(a).getTime() - parseBr(b).getTime(),
    );
  }, [visits]);

  if (visits.length === 0) {
    return <div className="agenda-empty"><div className="empty-title">Nenhuma visita agendada</div></div>;
  }
  return (
    <div className="agenda-groups">
      {groups.map(([day, items]) => (
        <section key={day} className="agenda-section">
          <h2 className="section-h">{day}</h2>
          <ul className="agenda-list">
            {items.map((v) => (
              <li key={v.id}><VisitItem v={v} /></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── Items ───────────────────────────────────────────────────────────────

function VisitItem({ v }: { v: VisitWithContext }) {
  const tone = VISIT_STATUS_TONE[v.status];
  return (
    <Link href={`/inbox/${v.lead_id}`} className="agenda-card">
      <div className="agenda-card-head">
        <span className={`agenda-kind kind-visit`}>Visita</span>
        <span className={`agenda-status tone-${tone}`}>
          {VISIT_STATUS_LABEL[v.status]}
        </span>
      </div>
      <div className="agenda-card-title">
        {v.lead_name ?? v.lead_phone ?? v.lead_id.slice(0, 6)}
      </div>
      <div className="agenda-card-meta">
        {v.empreendimento_nome ? <span>{v.empreendimento_nome}</span> : null}
        <span className="agenda-card-time">{fmtTime(v.scheduled_at)}</span>
      </div>
      {v.notes ? <div className="agenda-card-note">{v.notes}</div> : null}
    </Link>
  );
}

function FollowUpItem({ fu, compact }: { fu: FollowUpRowData; compact?: boolean }) {
  const lead = fu.leads;
  const name = lead?.full_name ?? lead?.push_name ?? lead?.phone ?? "—";
  return (
    <Link href={lead ? `/inbox/${lead.id}` : "#"} className="agenda-card">
      <div className="agenda-card-head">
        <span className="agenda-kind kind-fu">Follow-up · step {fu.step}</span>
        <span className={`agenda-status tone-${toneForFu(fu.status)}`}>{fu.status}</span>
      </div>
      <div className="agenda-card-title">{name}</div>
      {!compact && fu.message ? (
        <div className="agenda-card-note">{fu.message.slice(0, 140)}{fu.message.length > 140 ? "…" : ""}</div>
      ) : null}
      <div className="agenda-card-meta">
        <span className="agenda-card-time">
          {fu.status === "sent"
            ? `enviado ${fu.sent_at ? fmtDateTime(fu.sent_at) : "—"}`
            : `agendado ${fmtDateTime(fu.scheduled_for)}`}
        </span>
      </div>
    </Link>
  );
}

function toneForFu(status: FollowUpRowData["status"]): string {
  switch (status) {
    case "pending":
      return "default";
    case "sent":
      return "ok";
    case "failed":
      return "hot";
    case "cancelled":
      return "ghost";
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function parseBr(dmy: string): Date {
  const [d, m, y] = dmy.split("/").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
