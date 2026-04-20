import { supabaseAdmin } from "./supabase";

export type SystemSetting = {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
};

// Cache em memória com TTL de 60s — evita bater no banco a cada mensagem
let cache: Record<string, string> | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadAll(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("system_settings").select("key, value");
  if (error) {
    console.error("[settings] loadAll", error.message);
    return cache ?? {};
  }
  const loaded = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  cache = loaded;
  cacheAt = Date.now();
  return loaded;
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const all = await loadAll();
  return all[key] ?? fallback;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const val = await getSetting(key, String(fallback));
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("system_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  // Invalida cache
  cache = null;
}

export async function listSettings(): Promise<SystemSetting[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("system_settings")
    .select("*")
    .order("key");
  if (error) throw new Error(error.message);
  return (data ?? []) as SystemSetting[];
}
