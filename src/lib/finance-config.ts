/**
 * Vanguard · Track 3 · Slice 3.0 — adapter de config pra lib pura de finance.
 *
 * Lê `system_settings` (com TTL-cache via `getSetting*`) e expõe valores
 * prontos pra alimentar `src/lib/finance.ts`. A lib pura não conhece
 * banco nem env; este módulo é o único ponto de acoplamento.
 *
 * Invariants:
 *   - Defaults aqui batem com o seed da migration `20260424000001`.
 *   - Se admin desregistrar a feature (finance_enabled=false), callers
 *     devem checar `flags.enabled` antes de chamar as tools.
 */
import { getSettingBool, getSettingNumber } from "./settings";

export type FinanceFlags = {
  /** Kill switch geral. Quando false, tools de Track 3 são desregistradas. */
  enabled: boolean;
  /** Habilita a tool simulate_financing. */
  simulateEnabled: boolean;
  /** Habilita a tool check_mcmv. */
  mcmvEnabled: boolean;
  /**
   * Guardrail: se true, a Bia só simula com preço vindo do lead ou do
   * empreendimento (preco_inicial). Se false, aceita valores genéricos
   * — mais flexível, mais arriscado.
   */
  requireExplicitPrice: boolean;
};

export type FinanceDefaults = {
  /** Entrada padrão em % (0-100). Convertido de int pro prompt (ex: 20). */
  entryPct: number;
  /** Prazo padrão em meses. */
  termMonths: number;
  /** Taxa SBPE anual como decimal. Ex.: 0.115 = 11.5% a.a. */
  sbpeRateAnnual: number;
  /** Alíquota ITBI default em bps. Ex.: 200 = 2%. */
  itbiDefaultBps: number;
};

export type FinanceConfig = {
  flags: FinanceFlags;
  defaults: FinanceDefaults;
};

/**
 * Lê toda a config de Track 3 de uma vez.  Cache do `getSetting*` cobre
 * múltiplas chamadas da mesma request (TTL 60s).
 */
export async function getFinanceConfig(): Promise<FinanceConfig> {
  const [
    enabled,
    simulateEnabled,
    mcmvEnabled,
    requireExplicitPrice,
    entryPct,
    termMonths,
    sbpeRateBps,
    itbiDefaultBps,
  ] = await Promise.all([
    getSettingBool("finance_enabled", true),
    getSettingBool("finance_simulate_enabled", true),
    getSettingBool("finance_mcmv_enabled", true),
    getSettingBool("finance_require_explicit_price", true),
    getSettingNumber("finance_default_entry_pct", 20),
    getSettingNumber("finance_default_term_months", 360),
    getSettingNumber("finance_sbpe_rate_annual_bps", 1150),
    getSettingNumber("finance_itbi_default_bps", 200),
  ]);

  return {
    flags: {
      enabled,
      simulateEnabled: enabled && simulateEnabled,
      mcmvEnabled: enabled && mcmvEnabled,
      requireExplicitPrice,
    },
    defaults: {
      entryPct,
      termMonths,
      sbpeRateAnnual: sbpeRateBps / 10_000, // 1150 bps → 0.115
      itbiDefaultBps,
    },
  };
}
