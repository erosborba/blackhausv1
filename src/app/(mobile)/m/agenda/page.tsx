import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/auth/role-server";
import { listVisitsBetween, dayBoundsBR, type VisitWithContext } from "@/lib/visits";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * /m/agenda — versão enxuta da agenda. Três seções verticais:
 *  - visitas do dia
 *  - follow-ups pendentes (top 10)
 *  - próximas visitas (próximos 3 dias)
 *
 * Sem abas: tudo vertical, scroll único. Menor cognitive load no mobile.
 */
export default async function MobileAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const role = await getCurrentRole();
  if (role !== "admin" && role !== "corretor") redirect("/m/brief");

  const sp = await searchParams;
  const ref = sp?.day ? new Date(`${sp.day}T12:00:00-03:00`) : new Date();
  const validDay = !Number.isNaN(ref.getTime()) ? ref : new Date();
  const { from: dayFrom, to: dayTo } = dayBoundsBR(validDay);

  const sb = supabaseAdmin();
  const [visitsDay, pending, visitsNext] = await Promise.all([
    listVisitsBetween(dayFrom, dayTo),
    sb
      .from("follow_ups")
      .select(
        "id, lead_id, step, scheduled_for, status, leads(id, full_name, push_name, phone)",
      )
      .eq("status", "pending")
      .lte("scheduled_for", dayTo.toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(10),
    listVisitsBetween(
      new Date(dayTo.getTime() + 1),
      new Date(dayTo.getTime() + 3 * 24 * 3600 * 1000),
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
      <h1 className="m-page-title">Agenda</h1>
      <p className="m-page-sub">{dayLabel}</p>

      <div className="m-agenda-day-switch">
        <DayBtn delta={-1} day={validDay} label="← Ontem" />
        <Link href="/m/agenda" className="m-day-btn is-active">
          Hoje
        </Link>
        <DayBtn delta={1} day={validDay} label="Amanhã →" />
      </div>

      <section className="m-agenda-section" aria-label="Visitas do dia">
        <h2 className="m-agenda-section-h">Visitas · {visitsDay.length}</h2>
        {visitsDay.length === 0 ? (
          <div className="m-empty" style={{ padding: "24px 0" }}>
            Nenhuma visita marcada.
          </div>
        ) : (
          <div className="m-inbox-list">
            {visitsDay.map((v) => (
              <VisitRow key={v.id} v={v} />
            ))}
          </div>
        )}
      </section>

      <section className="m-agenda-section" aria-label="Follow-ups pendentes">
        <h2 className="m-agenda-section-h">Follow-ups · {pending.data?.length ?? 0}</h2>
        {(pending.data ?? []).length === 0 ? (
          <div className="m-empty" style={{ padding: "24px 0" }}>
            Nada pra disparar.
          </div>
        ) : (
          <div className="m-inbox-list">
            {(pending.data ?? []).map((fu: unknown) => (
              <FollowUpRow key={(fu as { id: string }).id} fu={fu} />
            ))}
          </div>
        )}
      </section>

      <section className="m-agenda-section" aria-label="Próximas visitas">
        <h2 className="m-agenda-section-h">Próximos 3 dias · {visitsNext.length}</h2>
        {visitsNext.length === 0 ? (
          <div className="m-empty" style={{ padding: "24px 0" }}>
            Nada agendado ainda.
          </div>
        ) : (
          <div className="m-inbox-list">
            {visitsNext.map((v) => (
              <VisitRow key={v.id} v={v} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function VisitRow({ v }: { v: VisitWithContext }) {
  const when = new Date(v.scheduled_at).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return (
    <Link href={`/inbox/${v.lead_id}`} className="m-inbox-item">
      <div className="m-inbox-avatar">📅</div>
      <div className="m-inbox-body">
        <div className="m-inbox-head">
          <div className="m-inbox-name">
            {v.lead_name ?? "—"}
          </div>
          <div className="m-inbox-when">{when}</div>
        </div>
        <div className="m-inbox-snippet">
          {v.empreendimento_nome ?? "—"}
        </div>
        <span className={`m-inbox-pill`}>{v.status}</span>
      </div>
    </Link>
  );
}

function FollowUpRow({ fu }: { fu: unknown }) {
  const r = fu as {
    id: string;
    step: number;
    lead_id: string;
    scheduled_for: string;
    leads?: unknown;
  };
  const leadRaw = r.leads as
    | { full_name?: string | null; push_name?: string | null; phone?: string | null }
    | Array<{ full_name?: string | null; push_name?: string | null; phone?: string | null }>
    | null;
  const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
  const name = lead?.full_name || lead?.push_name || lead?.phone || "—";
  const when = new Date(r.scheduled_for).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return (
    <Link href={`/inbox/${r.lead_id}`} className="m-inbox-item">
      <div className="m-inbox-avatar">⏰</div>
      <div className="m-inbox-body">
        <div className="m-inbox-head">
          <div className="m-inbox-name">{name}</div>
          <div className="m-inbox-when">{when}</div>
        </div>
        <div className="m-inbox-snippet">Follow-up · passo {r.step}</div>
      </div>
    </Link>
  );
}

function DayBtn({ delta, day, label }: { delta: number; day: Date; label: string }) {
  const next = new Date(day.getTime() + delta * 24 * 3600 * 1000);
  const yyyy = next.toLocaleString("en-US", { year: "numeric", timeZone: "America/Sao_Paulo" });
  const mm = String(Number(next.toLocaleString("en-US", { month: "numeric", timeZone: "America/Sao_Paulo" }))).padStart(2, "0");
  const dd = String(Number(next.toLocaleString("en-US", { day: "numeric", timeZone: "America/Sao_Paulo" }))).padStart(2, "0");
  return (
    <Link href={`/m/agenda?day=${yyyy}-${mm}-${dd}`} className="m-day-btn">
      {label}
    </Link>
  );
}
