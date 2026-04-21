import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { scanVisitReminders } from "@/lib/visit-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/visit-reminders — Track 2 · Slice 2.6 + 2.7.
 *
 * Varre `visits` com `scheduled_at` próximo de now±26h, emite os
 * lembretes apropriados (24h, 2h, post_visit) e grava idempotência
 * em `visit_reminders_sent`. Deve rodar a cada 5min.
 *
 * Auth: mesmo padrão dos outros crons (CRON_SECRET via Authorization
 * Bearer ou header `x-cron-secret`).
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
    const result = await scanVisitReminders();
    if (result.sent > 0 || result.failed > 0) {
      console.log("[cron/visit-reminders]", result);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/visit-reminders] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
