/**
 * Vanguard · Track 4 · Slice 4.4 — budget diário de TTS.
 *
 * Soma `cost_usd` de todas as linhas de `ai_usage_log` com
 * `provider='elevenlabs'` no dia corrente (UTC). Se >= cap, outbound
 * cai pra texto com `reason='budget_exceeded'`.
 *
 * Por que UTC e não timezone da aplicação:
 *   - Consistência com outros dashboards (usage já agrega em UTC)
 *   - Operador pensa em $/dia, rollover fora do horário comercial
 *     (00:00 UTC ≈ 21:00 BRT) é até desejável — não cortamos atendimento
 *     no pico
 *
 * Fail-soft: query falha → assume "ok" e deixa tentar síntese. A outra
 * alternativa (fail closed) fecharia a torneira do TTS a cada glitch
 * de DB, ruim pra UX.
 *
 * Separação pura × impura:
 *   - `isWithinBudget`   → pura (só aritmética, testável)
 *   - `getTtsSpendToday` → I/O (query ai_usage_log)
 *   - `checkTtsBudget`   → compõe os dois + lê setting
 */
import { supabaseAdmin } from "./supabase";
import { getSettingNumber } from "./settings";
import { isWithinBudget } from "./tts-pure";

// Re-export pra interface única ("import from tts-budget").
export { isWithinBudget };

// ---------------------------------------------------------------------------
// Impure
// ---------------------------------------------------------------------------

/**
 * Soma cost_usd das linhas TTS de hoje (UTC). Inclui falhas (ok=false)
 * porque a ElevenLabs cobra mesmo em caso de resposta inválida — o
 * custo já foi incorrido.
 *
 * Retorna 0 em erro de DB (fail-soft); o caller decide se isso é
 * motivo pra bloquear ou deixar passar.
 */
export async function getTtsSpendToday(): Promise<number> {
  try {
    const sb = supabaseAdmin();
    const since = startOfUtcDay(new Date()).toISOString();
    const { data, error } = await sb
      .from("ai_usage_log")
      .select("cost_usd")
      .eq("provider", "elevenlabs")
      .gte("created_at", since);

    if (error) {
      console.error("[tts-budget] query falhou:", error.message);
      return 0;
    }
    if (!data) return 0;

    let total = 0;
    for (const row of data) {
      // cost_usd vem como number (numeric) ou string dependendo do driver;
      // Number() normaliza sem NaN pra null/undefined.
      const c = Number((row as { cost_usd: unknown }).cost_usd);
      if (Number.isFinite(c)) total += c;
    }
    return total;
  } catch (e) {
    console.error("[tts-budget] getTtsSpendToday threw:", e);
    return 0;
  }
}

export type BudgetCheckResult = {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
};

/**
 * Chamado antes de cada `synthesize`. Retorna `allowed=false` se o
 * gasto de hoje + estimativa da próxima chamada passar do cap.
 *
 * `pendingUsd` vem do cálculo de custo por char (ver `computeTtsCostUsd`).
 * Passa 0 se quer checar só o spent até agora (sem intenção de incrementar).
 */
export async function checkTtsBudget(pendingUsd: number): Promise<BudgetCheckResult> {
  const capUsd = await getSettingNumber("tts_daily_cap_usd", 2);
  const spentUsd = await getTtsSpendToday();
  const allowed = isWithinBudget({ spentTodayUsd: spentUsd, pendingUsd, capUsd });
  return { allowed, spentUsd, capUsd };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
