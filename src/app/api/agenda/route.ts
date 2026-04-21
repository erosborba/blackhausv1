import { NextResponse, type NextRequest } from "next/server";
import { listVisitsBetween, dayBoundsBR } from "@/lib/visits";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agenda?day=YYYY-MM-DD
 *
 * Retorna o pacote da /agenda:
 *   - visits do dia
 *   - follow_ups pendentes vencidos até o fim do dia
 *   - follow_ups já enviados hoje (histórico curto)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dayParam = searchParams.get("day");

  const ref = dayParam ? new Date(`${dayParam}T12:00:00-03:00`) : new Date();
  if (Number.isNaN(ref.getTime())) {
    return NextResponse.json({ ok: false, error: "invalid_day" }, { status: 400 });
  }
  const { from, to } = dayBoundsBR(ref);

  const sb = supabaseAdmin();
  const [visits, pendingFu, sentFu] = await Promise.all([
    listVisitsBetween(from, to),
    sb
      .from("follow_ups")
      .select("*, leads:leads(id, full_name, push_name, phone, status, stage, score)")
      .eq("status", "pending")
      .lte("scheduled_for", to.toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(100),
    sb
      .from("follow_ups")
      .select("*, leads:leads(id, full_name, push_name, phone, status, stage, score)")
      .eq("status", "sent")
      .gte("sent_at", from.toISOString())
      .lte("sent_at", to.toISOString())
      .order("sent_at", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      day: from.toISOString().slice(0, 10),
      visits,
      pendingFollowUps: pendingFu.data ?? [],
      sentFollowUps: sentFu.data ?? [],
    },
  });
}
