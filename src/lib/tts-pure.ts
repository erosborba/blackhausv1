/**
 * Vanguard · Track 4 · Slice 4.1 — helpers puros do TTS.
 *
 * Só hashing e pricing. Extraído de `tts.ts` pra que `node:test` consiga
 * importar sem carregar `env` (que faz `schema.parse(process.env)` no
 * topo e explode sem as vars setadas) nem `supabaseAdmin`.
 *
 * Mirror da convenção `copilot-handoff.ts` × `copilot-suggestions.ts`
 * (Track 3): o lado puro fica sozinho num arquivo, o wrapper impuro
 * importa daqui.
 */
import { createHash } from "node:crypto";

/**
 * Pricing ElevenLabs turbo_v2_5 — $30 / 1M chars (plano Creator em
 * 2026-04). Se mudar plano, ajustar aqui E em `scripts/tts-test.mjs`
 * (que duplica o número pra evitar import de TS).
 */
export const ELEVENLABS_COST_PER_MCHAR = 30;

/**
 * Deriva a chave determinística do cache. Qualquer mudança em voice,
 * modelo ou texto muda o hash — ou seja, invalida corretamente sem
 * precisar versionar o bucket manualmente.
 *
 * Normaliza texto com `.trim()` pra que "oi!" e " oi! " colidam no
 * mesmo blob. NÃO normalizamos case nem pontuação: a ElevenLabs gera
 * prosódia diferente entre "oi." e "oi!", e a gente quer isso.
 */
export function ttsCacheKey(args: {
  text: string;
  voiceId: string;
  model: string;
}): string {
  const payload = `${args.voiceId}::${args.model}::${args.text.trim()}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Custo em USD pra um texto de N chars. Texto vazio → 0.
 * Arredondado em 6 casas pra bater com o resto do ai-usage.
 */
export function computeTtsCostUsd(charCount: number): number {
  if (charCount <= 0) return 0;
  const usd = (charCount * ELEVENLABS_COST_PER_MCHAR) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Budget check puro (Slice 4.4). Retorna `true` se `spentTodayUsd +
 * pendingUsd <= capUsd`. `capUsd <= 0` sempre bloqueia (kill switch
 * explícito quando operador quer desligar sem flipar `tts_enabled`).
 *
 * Semântica inclusiva no limite: o último centavo exato do dia ainda
 * sai — mais generoso com o operador que configurou valor redondo.
 */
export function isWithinBudget(args: {
  spentTodayUsd: number;
  pendingUsd: number;
  capUsd: number;
}): boolean {
  if (args.capUsd <= 0) return false;
  return args.spentTodayUsd + args.pendingUsd <= args.capUsd;
}
