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
        <VisitasTab visits={visitsWeek} dayIso={dayIso} />
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

/**
 * View semanal: grid de 7 colunas (seg→dom) com visitas do corretor.
 * A semana é ancorada no Monday da data de referência (`dayIso`). Visitas
 * fora da semana (±1 semana do horizonte do server) aparecem agrupadas
 * abaixo em "outras semanas" — raro, mas evita perder contexto.
 *
 * DoD 2.9: click em card → /inbox/<lead_id> (via VisitItem).
 */
function VisitasTab({ visits, dayIso }: { visits: VisitWithContext[]; dayIso: string }) {
  const { weekDays, inWeek, outside } = useMemo(() => {
    // Monday da semana de referência, no fuso BR.
    const ref = new Date(`${dayIso}T12:00:00-03:00`);
    const DOW_MAP: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const refDowStr = ref.toLocaleString("en-US", {
      weekday: "short",
      timeZone: "America/Sao_Paulo",
    });
    const refDow = DOW_MAP[refDowStr] ?? 1;
    // Monday = dow 1. Delta pra voltar ao monday da semana.
    const deltaToMon = refDow === 0 ? -6 : 1 - refDow;
    const monday = new Date(ref.getTime() + deltaToMon * 24 * 3600 * 1000);
    const days: { iso: string; label: string; short: string; isToday: boolean }[] = [];
    const todayBr = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 24 * 3600 * 1000);
      const brLabel = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
      const short = d
        .toLocaleDateString("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" })
        .replace(".", "")
        .slice(0, 3);
      const yyyy = d.toLocaleString("en-US", { year: "numeric", timeZone: "America/Sao_Paulo" });
      const mm = String(
        Number(d.toLocaleString("en-US", { month: "numeric", timeZone: "America/Sao_Paulo" })),
      ).padStart(2, "0");
      const dd = String(
        Number(d.toLocaleString("en-US", { day: "numeric", timeZone: "America/Sao_Paulo" })),
      ).padStart(2, "0");
      days.push({
        iso: `${yyyy}-${mm}-${dd}`,
        label: brLabel,
        short,
        isToday: brLabel === todayBr,
      });
    }

    const inWk = new Map<string, VisitWithContext[]>();
    days.forEach((d) => inWk.set(d.iso, []));
    const out: VisitWithContext[] = [];
    for (const v of visits) {
      const d = new Date(v.scheduled_at);
      const yyyy = d.toLocaleString("en-US", { year: "numeric", timeZone: "America/Sao_Paulo" });
      const mm = String(
        Number(d.toLocaleString("en-US", { month: "numeric", timeZone: "America/Sao_Paulo" })),
      ).padStart(2, "0");
      const dd = String(
        Number(d.toLocaleString("en-US", { day: "numeric", timeZone: "America/Sao_Paulo" })),
      ).padStart(2, "0");
      const iso = `${yyyy}-${mm}-${dd}`;
      if (inWk.has(iso)) inWk.get(iso)!.push(v);
      else out.push(v);
    }
    for (const arr of inWk.values()) {
      arr.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    }
    return { weekDays: days, inWeek: inWk, outside: out };
  }, [visits, dayIso]);

  const totalInWeek = Array.from(inWeek.values()).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="agenda-week">
      <div className="agenda-week-grid">
        {weekDays.map((d) => {
          const items = inWeek.get(d.iso) ?? [];
          return (
            <div
              key={d.iso}
              className={`agenda-week-col ${d.isToday ? "is-today" : ""}`}
              data-empty={items.length === 0 ? "1" : undefined}
            >
              <div className="agenda-week-head">
                <span className="agenda-week-dow">{d.short}</span>
                <span className="agenda-week-date">{d.label}</span>
              </div>
              {items.length === 0 ? (
                <div className="agenda-week-empty">—</div>
              ) : (
                <ul className="agenda-week-list">
                  {items.map((v) => (
                    <li key={v.id}>
                      <WeekVisitCard v={v} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {totalInWeek === 0 && outside.length === 0 ? (
        <div className="agenda-empty">
          <div className="empty-title">Nenhuma visita agendada</div>
          <div className="empty-sub">Nada nessa semana. Marca via Bia ou handoff.</div>
        </div>
      ) : null}

      {outside.length > 0 ? (
        <section className="agenda-section" style={{ marginTop: 28 }}>
          <h2 className="section-h">Fora desta semana</h2>
          <p className="section-sub">{outside.length} visita(s) em outras semanas do horizonte.</p>
          <ul className="agenda-list">
            {outside
              .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
              .map((v) => (
                <li key={v.id}>
                  <VisitItem v={v} />
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Variante compacta do VisitItem pro grid semanal — mais verticalmente
 * denso, mostra só hora + nome + emp.
 */
function WeekVisitCard({ v }: { v: VisitWithContext }) {
  const tone = VISIT_STATUS_TONE[v.status];
  return (
    <Link href={`/inbox/${v.lead_id}`} className={`agenda-week-card tone-${tone}`}>
      <div className="agenda-week-card-time">{fmtTime(v.scheduled_at)}</div>
      <div className="agenda-week-card-name">
        {v.lead_name ?? v.lead_phone ?? v.lead_id.slice(0, 6)}
      </div>
      {v.empreendimento_nome ? (
        <div className="agenda-week-card-emp">{v.empreendimento_nome}</div>
      ) : null}
    </Link>
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

