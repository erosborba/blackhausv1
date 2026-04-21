import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/[id]/timeline
 *
 * Últimos N eventos do lead (lead_events table) em ordem reversa.
 * Alimenta o painel de contexto (coluna 3) do /inbox/[id].
 *
 * Query: ?limit=50 (default 50, max 200).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(200, Math.floor(limitParam)))
    : 50;

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("lead_timeline", {
    p_lead_id: id,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data });
}
