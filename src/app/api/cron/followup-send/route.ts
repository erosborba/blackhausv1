import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { processDueFollowUps } from "@/lib/follow-ups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/followup-send
 *
 * Processa follow-ups pending vencidos respeitando rate/min e janela
 * horária. Deve rodar a cada 1 minuto.
 *
 * Anti-ban: o rate limit é aplicado dentro de processDueFollowUps
 * (followup_rate_per_min). Fora da janela retorna noop.
 *
 * Auth: mesmo esquema do /api/cron/cleanup (CRON_SECRET).
 */

async function handle(req: NextRequest) {
  const gate = checkCronAuth(req);
  if (gate) return gate;

  try {
    const result = await processDueFollowUps();
    if (result.sent > 0 || result.failed > 0) {
      console.log("[cron/followup-send]", result);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/followup-send] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
