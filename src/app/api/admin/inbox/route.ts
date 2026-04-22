import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireSessionApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireSessionApi();
  if (gate instanceof NextResponse) return gate;
  const search = req.nextUrl.searchParams.get("q");
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("inbox_items", {
    search_text: search && search.trim().length > 0 ? search.trim() : null,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data });
}
