/**
 * Vanguard · Track 3 · Slice 3.2 — lookup de ITBI por cidade.
 *
 * A tabela `cities_fiscal` tem ~50 linhas (capitais + metropolitanas),
 * cresce devagar. Carregamos tudo em memória com TTL de 5 minutos —
 * muito mais agressivo que `system_settings` (60s) porque:
 *   1. Muda raramente (prefeitura publica decreto, não é diário)
 *   2. Hit-rate alto: toda simulação que conhece a cidade consulta aqui
 *   3. Invalidação manual é fácil (restart / TTL curto o suficiente
 *      pra hotfix chegar em minutos)
 *
 * **Fallback chain** (do ponto de vista do caller):
 *   1. `getCityFiscal(cidade, uf)` — ideal: cidade cadastrada
 *   2. se null → `finance_itbi_default_bps` do system_settings
 *   3. se ainda null → 200 bps (2%) hardcoded no adapter
 *
 * A lib pura (`src/lib/finance.ts > itbi()`) só conhece bps + valor.
 * Este módulo é o único ponto de acoplamento com banco pra ITBI.
 */
import { supabaseAdmin } from "./supabase";
import { citySlug, normalizeUf } from "./city-slug";

export type CityFiscal = {
  cidadeSlug: string;
  uf: string;
  cidadeDisplay: string;
  itbiBps: number;
  regCartorioBps: number | null;
  source: string | null;
};

type CacheRow = {
  cidade_slug: string;
  uf: string;
  cidade_display: string;
  itbi_bps: number;
  reg_cartorio_bps: number | null;
  source: string | null;
};

// Cache em memória com TTL de 5 minutos (cidades mudam raramente).
let cache: Map<string, CityFiscal> | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 5 * 60_000;

function cacheKey(slug: string, uf: string): string {
  return `${uf}:${slug}`;
}

async function loadAll(): Promise<Map<string, CityFiscal>> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("cities_fiscal")
    .select("cidade_slug, uf, cidade_display, itbi_bps, reg_cartorio_bps, source");
  if (error) {
    console.error("[cities-fiscal] loadAll", error.message);
    // Em falha, mantém cache antigo se houver, ou devolve vazio sem
    // estourar — caller cai no default.
    return cache ?? new Map();
  }
  const map = new Map<string, CityFiscal>();
  for (const row of (data ?? []) as CacheRow[]) {
    map.set(cacheKey(row.cidade_slug, row.uf), {
      cidadeSlug: row.cidade_slug,
      uf: row.uf,
      cidadeDisplay: row.cidade_display,
      itbiBps: row.itbi_bps,
      regCartorioBps: row.reg_cartorio_bps,
      source: row.source,
    });
  }
  cache = map;
  cacheAt = Date.now();
  return map;
}

/**
 * Busca ITBI + dados da cidade. Tolera variação de caixa/acento no nome.
 * Retorna null se a cidade não está cadastrada — caller cai no default.
 */
export async function getCityFiscal(
  cidade: string | null | undefined,
  uf: string | null | undefined,
): Promise<CityFiscal | null> {
  const slug = citySlug(cidade ?? "");
  const ufNorm = normalizeUf(uf);
  if (!slug || !ufNorm) return null;
  const all = await loadAll();
  return all.get(cacheKey(slug, ufNorm)) ?? null;
}

/**
 * Resolve a alíquota ITBI a aplicar, com fallback pra default.
 * Retorna `{ bps, source }` pra caller decidir se cola rótulo no texto
 * (ex.: "ITBI de {cidadeDisplay}" vs "ITBI médio de 2%").
 */
export async function resolveItbiBps(
  cidade: string | null | undefined,
  uf: string | null | undefined,
  fallbackBps: number,
): Promise<{ bps: number; source: "city" | "default"; city?: CityFiscal }> {
  const city = await getCityFiscal(cidade, uf);
  if (city) return { bps: city.itbiBps, source: "city", city };
  return { bps: fallbackBps, source: "default" };
}

/**
 * Invalida o cache manualmente. Útil em admin routes que atualizam
 * a tabela (migration futura ou UI de edição). Não exposto ainda.
 */
export function invalidateCitiesFiscalCache(): void {
  cache = null;
  cacheAt = 0;
}
