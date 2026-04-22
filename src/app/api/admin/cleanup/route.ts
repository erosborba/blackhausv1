import { NextResponse } from "next/server";
import { runAllCleanup } from "@/lib/cleanup";
import { requireAdminApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/cleanup
 *
 * Versão "admin" do cron — mesmo runAllCleanup, mas sem a checagem de
 * CRON_SECRET. Serve pro botão "Executar agora" na página /admin/cleanup.
 */
export async function POST() {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  try {
    const result = await runAllCleanup();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
