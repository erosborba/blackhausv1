import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { processHandoffEscalations } from "@/lib/handoffQueue";
import { escalateHandoff } from "@/lib/handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/handoff
 *
 * Processa escalações de handoff vencidas. Deve rodar a cada minuto.
 *
 * Vercel Cron (vercel.json):
 *   { "path": "/api/cron/handoff", "schedule": "* * * * *" }
 *
 * Railway: scheduled job com `curl -H "x-cron-secret: $CRON_SECRET" $APP_BASE_URL/api/cron/handoff`
 *   Frequência: a cada 1 minuto.
 *
 * Auth: mesmo esquema do /api/cron/cleanup (CRON_SECRET).
 */

async function handle(req: NextRequest) {
  const gate = checkCronAuth(req);
  if (gate) return gate;

  try {
    const result = await processHandoffEscalations(escalateHandoff);
    console.log("[cron/handoff]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/handoff] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
