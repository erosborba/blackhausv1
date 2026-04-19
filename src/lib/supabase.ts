import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// IMPORTANTE: NÃO importar `./env` aqui. Este arquivo também é carregado no
// bundle do navegador (via supabaseBrowser), e `env.ts` faz `schema.parse` em
// top-level — que falha no browser porque vars não-NEXT_PUBLIC ficam undefined.
// Em vez disso, lemos process.env direto e validamos no momento da chamada.

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes");
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

let _browser: SupabaseClient | null = null;

/**
 * Client anon para uso no navegador (realtime subscriptions, reads públicos).
 * Lê `process.env.NEXT_PUBLIC_*` direto — Next inlina no bundle. Não importa
 * `env` do servidor porque o Zod do env.ts quebra no browser (vars server-only
 * ficam undefined).
 */
export function supabaseBrowser(): SupabaseClient {
  if (_browser) return _browser;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes");
  }
  _browser = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _browser;
}
