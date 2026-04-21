import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/[id]
 *
 * Lead + últimas N mensagens (com sources). Alimenta a coluna central
 * (thread) do /inbox/[id]. Querystring: ?limit=50 (default 50, max 500).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(500, Math.floor(limitParam)))
    : 50;

  const sb = supabaseAdmin();
  const [leadRes, msgsRes] = await Promise.all([
    sb.from("leads").select("*").eq("id", id).maybeSingle(),
    sb
      .from("messages")
      .select(
        "id, role, direction, content, created_at, media_type, media_path, media_mime, media_duration_ms, sources",
      )
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (leadRes.error) {
    return NextResponse.json({ ok: false, error: leadRes.error.message }, { status: 500 });
  }
  if (!leadRes.data) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  // Mensagens retornadas em ordem cronológica (oldest → newest) pra UI
  // montar a thread sem precisar reverter.
  const messages = (msgsRes.data ?? []).slice().reverse();
  return NextResponse.json({
    ok: true,
    data: { lead: leadRes.data, messages },
  });
}
