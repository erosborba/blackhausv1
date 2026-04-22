/**
 * Leaky bucket rate limiter in-memory.
 *
 * Uso pretendido: proteger o webhook Evolution contra loops e secret
 * vazado, limitando chamadas LLM/Whisper por remoteJid.
 *
 * Limites:
 *  - In-memory (Map no módulo) — bom pro Railway single-process. Se
 *    migrar pra serverless ou horizontal scale, trocar por Redis/Postgres.
 *  - Sem coordenação entre instâncias. Cada processo tem seu próprio bucket.
 *
 * API: `take(key, cfg)` retorna { allowed, retryAfterMs }.
 */

export type BucketConfig = {
  /** Capacidade do bucket (burst máximo). */
  capacity: number;
  /** Tokens reabastecidos por minuto. */
  refillPerMinute: number;
};

type BucketState = {
  tokens: number;
  lastRefill: number;
};

const buckets = new Map<string, BucketState>();

// GC leve pra evitar que chaves inativas fiquem pra sempre. Executa quando
// a Map cresce além de N entradas.
const GC_THRESHOLD = 10_000;
const GC_IDLE_MS = 15 * 60 * 1000;

function gcIfNeeded(now: number) {
  if (buckets.size < GC_THRESHOLD) return;
  for (const [key, state] of buckets) {
    if (now - state.lastRefill > GC_IDLE_MS) buckets.delete(key);
  }
}

export function take(
  key: string,
  cfg: BucketConfig,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  gcIfNeeded(now);

  let state = buckets.get(key);
  if (!state) {
    state = { tokens: cfg.capacity, lastRefill: now };
    buckets.set(key, state);
  }

  const elapsedMs = Math.max(0, now - state.lastRefill);
  const refill = (elapsedMs / 60_000) * cfg.refillPerMinute;
  state.tokens = Math.min(cfg.capacity, state.tokens + refill);
  state.lastRefill = now;

  if (state.tokens >= 1) {
    state.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  const needed = 1 - state.tokens;
  const retryAfterMs = Math.ceil((needed / cfg.refillPerMinute) * 60_000);
  return { allowed: false, retryAfterMs };
}

/** Reset pra testes. Não usar em runtime. */
export function __resetAllBuckets() {
  buckets.clear();
}
