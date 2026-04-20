import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
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
 *
 * Auth:
 *  - Vercel Cron automaticamente envia `Authorization: Bearer <CRON_SECRET>`
 *    quando a env var existe no projeto. A gente valida aqui.
 *  - Se CRON_SECRET não está setada, aceita sem auth (dev/local). Em prod,
 *    SEMPRE setar — senão qualquer um dispara a limpeza acessando a URL.
 *
 * POST também suportado (alguns crons mandam POST por padrão).
 *
 * Resposta:
 *  - 200 com JSON detalhado (ver runAllCleanup). Mesmo com erros parciais
 *    retorna 200 — o cron vai usar essa resposta pra log; 5xx só em falha
 *    geral (ex.: DB inacessível).
 */

function isAuthorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true; // sem secret configurado: endpoint aberto (dev)
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Aceita também x-cron-secret pra crons que não suportam Authorization
  const alt = req.headers.get("x-cron-secret") ?? "";
  return header === expected || alt === secret;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

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
