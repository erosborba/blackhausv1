import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Middleware Edge — faz duas coisas:
 *
 *   1. **Auth gate**: se o usuário não tem sessão Supabase, redireciona
 *      pra `/login?next=<path>` em qualquer rota protegida.
 *
 *   2. **Mobile UA redirect** (flag-gated por MOBILE_UA_REDIRECT=1): UA
 *      mobile cai em `/m/*` se disponível. Respeita cookie `bh-view=desktop`.
 *
 * Nunca redireciona:
 *   - /login, /api/auth/*        (loop/circular)
 *   - /api/webhook/*, /api/cron/*, /api/handoff/* (webhooks públicos
 *     com auth própria via secret header)
 *   - /m/* já é mobile (para o UA redirect)
 *
 * Auth é desligado em dev quando BH_ALLOW_ROLE_STUB=1 + NODE_ENV!==production
 * (mantém fluxo sem login no desenvolvimento single-user).
 */

const MOBILE_PREFIX = "/m";
const DESKTOP_VIEW_COOKIE = "bh-view";

const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/": "/m/brief",
  "/brief": "/m/brief",
  "/inbox": "/m/inbox",
  "/agenda": "/m/agenda",
  "/revisao": "/m/decisions",
};

const MOBILE_UA_REGEX =
  /Android|iPhone|iPad|iPod|Mobile|Windows Phone|BlackBerry|Opera Mini/i;

/** Paths que NUNCA exigem sessão (login flow, webhooks com auth própria). */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/webhook/")) return true;
  if (pathname.startsWith("/api/cron/")) return true;
  if (pathname.startsWith("/api/handoff/")) return true;
  // Rota pública de handoff (corretor clica link do WhatsApp sem login).
  if (pathname.startsWith("/handoff/")) return true;
  return false;
}

/** Dev backdoor: sem login é OK enquanto stub está ligado. */
function authDisabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.BH_ALLOW_ROLE_STUB === "1"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const response = NextResponse.next();

  // ---------- 0. Supabase auth callback rescue ----------
  // Em alguns casos (Site URL vs Redirect URL mismatch, erros do OAuth)
  // o Supabase redireciona pro root `/` com `?code=` ou `?error=` em vez
  // do nosso `/api/auth/callback`. Redireciona pra lá sem perder params.
  if (pathname === "/" && (searchParams.has("code") || searchParams.has("error"))) {
    const url = req.nextUrl.clone();
    if (searchParams.has("code")) {
      url.pathname = "/api/auth/callback";
      return NextResponse.redirect(url);
    }
    // Erro do provider: manda pro /login com a mensagem.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?err=${encodeURIComponent(
      searchParams.get("error_code") || searchParams.get("error") || "oauth",
    )}`;
    return NextResponse.redirect(loginUrl);
  }

  // ---------- 1. Auth gate ----------
  if (!authDisabled() && !isPublicPath(pathname)) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && anon) {
      const supa = createServerClient(url, anon, {
        cookies: {
          getAll() {
            return req.cookies.getAll().map((c) => ({
              name: c.name,
              value: c.value,
            }));
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options as CookieOptions);
            }
          },
        },
      });

      const { data } = await supa.auth.getUser();
      if (!data?.user) {
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
        return NextResponse.redirect(loginUrl);
      }
    }
    // Se env faltar, cai pro próximo check em vez de quebrar todo mundo.
  }

  // ---------- 2. Mobile UA redirect ----------
  if (process.env.MOBILE_UA_REDIRECT === "1") {
    if (!pathname.startsWith(MOBILE_PREFIX)) {
      const viewPref = req.cookies.get(DESKTOP_VIEW_COOKIE)?.value;
      if (viewPref !== "desktop") {
        const ua = req.headers.get("user-agent") ?? "";
        if (MOBILE_UA_REGEX.test(ua)) {
          const target = DESKTOP_TO_MOBILE[pathname] ?? "/m/brief";
          const url = req.nextUrl.clone();
          url.pathname = target;
          return NextResponse.redirect(url, 307);
        }
      }
    }
  }

  return response;
}

/**
 * Matcher: tudo menos static, arquivos com extensão, admin legacy.
 * API rotas entram (pra auth gate), exceto as isPublicPath acima.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|sw.js|admin).*)",
  ],
};
