import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { runAllCleanup } from "@/lib/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cleanup pode demorar (lista bucket recursivo). Subindo o timeout pra 300s
// nos planos Vercel que permitem; em Hobby o cap é 60s e basta até crescer.
export const maxDuration = 300;

/**
 * GET /api/cron/cleanup
 *
 * Endpoint chamado 1x/dia pelo cron (Vercel Cron ou Railway/GitHub Actions).
 * Auth via `checkCronAuth` (CRON_SECRET — fail-closed em produção).
 * POST também suportado (alguns crons mandam POST por padrão).
 *
 * Resposta:
 *  - 200 com JSON detalhado (ver runAllCleanup). Mesmo com erros parciais
 *    retorna 200 — o cron vai usar essa resposta pra log; 5xx só em falha
 *    geral (ex.: DB inacessível).
 */

async function handle(req: NextRequest) {
  const gate = checkCronAuth(req);
  if (gate) return gate;

  try {
    const result = await runAllCleanup();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/cleanup] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
