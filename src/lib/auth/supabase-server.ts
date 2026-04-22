import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SSR-scoped Supabase client. Lê/grava cookies via `next/headers` —
 * sessão de auth vai dentro desses cookies (httpOnly). Cria um client
 * novo por request (sem cache singleton) porque cookies mudam.
 *
 * Separado do `supabaseAdmin()` / `supabaseBrowser()` (em `src/lib/supabase.ts`)
 * porque aquele arquivo é isomórfico e não pode importar `next/headers`.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausentes");
  }

  // `cookies()` é async no Next 15.
  const cookieStore = await cookies();

  return createServerClient(url, publishable, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // Server Components não podem setar cookies — ignorado
          // (middleware e route handlers fazem o refresh). Não é erro.
        }
      },
    },
  });
}
