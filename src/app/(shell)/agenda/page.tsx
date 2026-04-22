import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { listVisitsBetween, dayBoundsBR } from "@/lib/visits";
import { supabaseAdmin } from "@/lib/supabase";
import { AgendaTabs } from "@/components/agenda/AgendaTabs";
import type { AgendaTab, FollowUpRowData } from "@/components/agenda/types";
import "./agenda.css";

export const dynamic = "force-dynamic";

/**
 * /agenda — o "dia do corretor".
 *
 * Três abas:
 *  - Hoje: visitas + follow_ups pendentes pro dia (agregado)
 *  - Follow-ups: pendentes + enviados na janela (mais próximo ao antigo /admin/follow-ups)
 *  - Visitas: lista da semana, agrupada por dia
 *
 * Filtragem por dia via ?day=YYYY-MM-DD. Aba via ?tab=.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; day?: string }>;
}) {
  const sp = await searchParams;
  const initialTab: AgendaTab =
    sp?.tab === "follow-ups" || sp?.tab === "visitas" ? sp.tab : "hoje";

  const ref = sp?.day ? new Date(`${sp.day}T12:00:00-03:00`) : new Date();
  const validDay = !Number.isNaN(ref.getTime()) ? ref : new Date();
  const { from: dayFrom, to: dayTo } = dayBoundsBR(validDay);

  // Pacote "hoje".
  const sb = supabaseAdmin();
  const [visitsDay, pendingFu, sentFu, visitsWeek] = await Promise.all([
    listVisitsBetween(dayFrom, dayTo),
    sb
      .from("follow_ups")
      .select(
        "id, lead_id, step, scheduled_for, status, message, sent_at, leads(id, full_name, push_name, phone, status, stage, score)",
      )
      .eq("status", "pending")
      .lte("scheduled_for", dayTo.toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(100),
    sb
      .from("follow_ups")
      .select(
        "id, lead_id, step, scheduled_for, status, message, sent_at, leads(id, full_name, push_name, phone, status, stage, score)",
      )
      .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .in("status", ["sent", "cancelled", "failed"])
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(60),
    listVisitsBetween(
      new Date(dayFrom.getTime() - 3 * 24 * 3600 * 1000),
      new Date(dayFrom.getTime() + 14 * 24 * 3600 * 1000),
    ),
  ]);

  const dayLabel = validDay.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <>
      <Topbar crumbs={[{ label: "Agenda" }, { label: dayLabel }]} />
      <main className="page-body agenda-page">
        <header className="agenda-head">
          <div>
            <h1 className="display">Agenda</h1>
            <p className="agenda-sub">
              Visitas e follow-ups do dia. Alternar entre ontem/hoje/amanhã pela URL (?day=).
            </p>
          </div>
          <div className="agenda-day-switch">
            <DayNav day={validDay} delta={-1} label="← Ontem" />
            <Link href="/agenda" className="switch-btn">Hoje</Link>
            <DayNav day={validDay} delta={1} label="Amanhã →" />
          </div>
        </header>

        <AgendaTabs
          initialTab={initialTab}
          visitsDay={visitsDay}
          pendingFu={normalizeFu(pendingFu.data ?? [])}
          sentFu={normalizeFu(sentFu.data ?? [])}
          visitsWeek={visitsWeek}
          dayIso={dayFrom.toISOString().slice(0, 10)}
        />
      </main>
    </>
  );
}

/**
 * Supabase devolve o embedded select de `leads(...)` como array — mesmo
 * sendo FK 1:1 do ponto de vista lógico, o schema expõe como relação.
 * Flatten pro shape que a UI consome.
 */
function normalizeFu(rows: unknown[]): FollowUpRowData[] {
  return rows.map((raw) => {
    const r = raw as Record<string, unknown> & { leads?: unknown };
    const leadsRaw = r.leads;
    const lead = Array.isArray(leadsRaw) ? (leadsRaw[0] ?? null) : (leadsRaw ?? null);
    return {
      id: String(r.id),
      lead_id: String(r.lead_id),
      step: Number(r.step),
      scheduled_for: String(r.scheduled_for),
      status: r.status as FollowUpRowData["status"],
      message: (r.message as string | null) ?? null,
      sent_at: (r.sent_at as string | null) ?? null,
      leads: lead
        ? (lead as FollowUpRowData["leads"])
        : null,
    };
  });
}

function DayNav({ day, delta, label }: { day: Date; delta: number; label: string }) {
  const next = new Date(day.getTime() + delta * 24 * 3600 * 1000);
  const yyyy = next.toLocaleString("en-US", { year: "numeric", timeZone: "America/Sao_Paulo" });
  const mm = String(Number(next.toLocaleString("en-US", { month: "numeric", timeZone: "America/Sao_Paulo" }))).padStart(2, "0");
  const dd = String(Number(next.toLocaleString("en-US", { day: "numeric", timeZone: "America/Sao_Paulo" }))).padStart(2, "0");
  return (
    <Link className="switch-btn" href={`/agenda?day=${yyyy}-${mm}-${dd}`}>
      {label}
    </Link>
  );
}

