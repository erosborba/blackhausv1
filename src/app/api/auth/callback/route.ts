import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/supabase-server";

/**
 * GET /api/auth/callback?code=...&next=/brief
 *
 * Supabase manda pra cá depois do clique no magic-link. Trocamos o code
 * por uma sessão (que vai nos cookies) e redirecionamos pra `next` ou /brief.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/brief";

  if (!code) {
    return NextResponse.redirect(new URL("/login?err=missing_code", url.origin));
  }

  const supa = await supabaseServer();
  const { error } = await supa.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback]", error);
    return NextResponse.redirect(new URL("/login?err=exchange_failed", url.origin));
  }

  // `next` precisa ser relativo — evita open-redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/brief";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
