import { NextResponse } from "next/server";
import { getPipelineBoard } from "@/lib/pipeline";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline
 * Board completo (counts + leads por stage). Leitura usada pelo SSR do
 * /pipeline e pra revalidar depois de um move.
 */
export async function GET() {
  const role = await getCurrentRole();
  if (!can(role, "pipeline.view")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const board = await getPipelineBoard(50);
  return NextResponse.json({ ok: true, data: board });
}
