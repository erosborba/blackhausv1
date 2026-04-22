import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Auth dos endpoints /api/cron/*.
 *
 * Aceita:
 *   - `Authorization: Bearer <CRON_SECRET>` (Vercel Cron envia assim)
 *   - `x-cron-secret: <CRON_SECRET>` (alguns crons não permitem Authorization)
 *
 * Política:
 *   - Produção + sem CRON_SECRET configurado → 500 (fail-closed). Nunca
 *     expor cron endpoints sem secret em prod.
 *   - Dev/teste sem CRON_SECRET → passa direto (endpoint aberto).
 *   - Header não bate → 401.
 *
 * Uso:
 *   const gate = checkCronAuth(req);
 *   if (gate) return gate;
 */
export function checkCronAuth(req: NextRequest): NextResponse | null {
  const secret = env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error("[cron-auth] CRON_SECRET ausente em produção — fail-closed");
      return NextResponse.json(
        { ok: false, error: "cron_secret_not_configured" },
        { status: 500 },
      );
    }
    return null;
  }

  const header = req.headers.get("authorization") ?? "";
  const alt = req.headers.get("x-cron-secret") ?? "";
  const ok = header === `Bearer ${secret}` || alt === secret;
  if (!ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
