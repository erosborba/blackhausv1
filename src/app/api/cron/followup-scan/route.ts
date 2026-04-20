import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { scanAndScheduleFollowUps } from "@/lib/follow-ups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/followup-scan
 *
 * Scan diário (1x/dia) que identifica leads elegíveis e agenda o 1º
 * follow-up. Os envios em si são feitos por /api/cron/followup-send.
 *
 * Frequência recomendada: 1x/dia, preferencialmente de manhã dentro da
 * janela de envio (ex: 09:15 UTC-3).
 *
 * Auth: mesmo esquema do /api/cron/cleanup (CRON_SECRET).
 */

function isAuthorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  const alt = req.headers.get("x-cron-secret") ?? "";
  return header === `Bearer ${secret}` || alt === secret;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await scanAndScheduleFollowUps();
    console.log("[cron/followup-scan]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/followup-scan] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
