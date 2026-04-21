/**
 * Vanguard · Track 3 · Slice 3.1 — lib pura de simulação financeira.
 *
 * Funções puras — não chamam banco, não dependem de env. Toda config
 * (taxa SBPE, ITBI default, etc.) é passada como argumento. O adapter
 * em `src/lib/finance-config.ts` lê do `system_settings` e injeta.
 *
 * Cobre:
 *   - SBPE (Tabela Price): parcela constante
 *   - SAC: amortização constante, parcela decrescente
 *   - MCMV: faixas de elegibilidade (constantes com SOURCE_DATE)
 *   - FGTS: regras básicas de uso no SFH
 *   - ITBI: cálculo simples a partir de bps
 *
 * Invariants: I-6 (determinismo — mesmo input = mesmo output).
 */

// ──────────────────────────────────────────────────────────────────────
// Tipos comuns
// ──────────────────────────────────────────────────────────────────────

export type AmortizationSystem = "sbpe" | "sac";

export type AmortizationInput = {
  /** Valor financiado em reais (após entrada). */
  principal: number;
  /** Taxa anual como decimal. Ex.: 0.115 = 11.50% a.a. */
  rateAnnual: number;
  /** Prazo em meses. */
  months: number;
};

export type AmortizationResult = {
  system: AmortizationSystem;
  /** Parcela do primeiro mês (BRL). */
  firstPayment: number;
  /** Parcela do último mês (BRL). No SBPE é igual à primeira. */
  lastPayment: number;
  /** Soma de todas as parcelas (BRL). */
  totalPaid: number;
  /** Total de juros pagos (BRL). totalPaid − principal. */
  totalInterest: number;
  /** CET anual aproximado como decimal. Sem taxas extras, bate com rateAnnual. */
  cetAnnual: number;
};

// ──────────────────────────────────────────────────────────────────────
// SBPE (Tabela Price) — parcela constante
// ──────────────────────────────────────────────────────────────────────

/**
 * SBPE/Price: PMT = P · r / (1 − (1+r)^−n), onde r = rateAnnual/12.
 *
 * A parcela é constante durante todo o prazo. Primeira parcela = última.
 */
export function sbpe(input: AmortizationInput): AmortizationResult {
  validateAmortInput(input);
  const { principal, rateAnnual, months } = input;
  const r = rateAnnual / 12;

  let pmt: number;
  if (r === 0) {
    // Edge case: taxa zero vira amortização linear (raro mas matematicamente definido).
    pmt = principal / months;
  } else {
    pmt = (principal * r) / (1 - Math.pow(1 + r, -months));
  }

  const totalPaid = pmt * months;
  const totalInterest = totalPaid - principal;

  return {
    system: "sbpe",
    firstPayment: round2(pmt),
    lastPayment: round2(pmt),
    totalPaid: round2(totalPaid),
    totalInterest: round2(totalInterest),
    cetAnnual: rateAnnual,
  };
}

// ──────────────────────────────────────────────────────────────────────
// SAC — amortização constante, parcela decrescente
// ──────────────────────────────────────────────────────────────────────

/**
 * SAC: amortização A = P/n constante; juros do mês k = (P − (k−1)·A) · r.
 * Primeira parcela = A + P·r (maior). Última = A + A·r = A·(1+r).
 *
 * Total de juros = r · P · (n+1) / 2 (soma de PA).
 */
export function sac(input: AmortizationInput): AmortizationResult {
  validateAmortInput(input);
  const { principal, rateAnnual, months } = input;
  const r = rateAnnual / 12;

  const amort = principal / months;
  const firstPayment = amort + principal * r;
  const lastPayment = amort + amort * r;
  const totalInterest = (r * principal * (months + 1)) / 2;
  const totalPaid = principal + totalInterest;

  return {
    system: "sac",
    firstPayment: round2(firstPayment),
    lastPayment: round2(lastPayment),
    totalPaid: round2(totalPaid),
    totalInterest: round2(totalInterest),
    cetAnnual: rateAnnual,
  };
}

// ──────────────────────────────────────────────────────────────────────
// MCMV — faixas de elegibilidade
// ──────────────────────────────────────────────────────────────────────

/**
 * Data de referência das faixas MCMV hardcoded abaixo.
 * Quando a Caixa revisa, abre nova migration + atualiza esta constante.
 */
export const MCMV_SOURCE_DATE = "2024-02-01";

export type McmvBandId = "urbano_1" | "urbano_2" | "urbano_3" | "none";

export type McmvBand = {
  id: McmvBandId;
  label: string;
  /** Teto de renda mensal bruta familiar (BRL). */
  maxIncome: number;
  /** Teto de valor do imóvel no programa (BRL). */
  maxPropertyValue: number;
  /** Subsídio máximo do FGTS (BRL). 0 quando não há subsídio. */
  subsidyMax: number;
  /** Taxa anual típica da faixa como decimal. */
  rateAnnual: number;
};

/**
 * Faixas MCMV — referência 2024. Valores médios nacionais; cidades
 * específicas podem ter tetos diferentes (ignoramos variação regional
 * nesta versão — suficiente pra conversa inicial com o lead).
 */
export const MCMV_BANDS: readonly McmvBand[] = Object.freeze([
  {
    id: "urbano_1",
    label: "Faixa Urbano 1",
    maxIncome: 2640,
    maxPropertyValue: 264000,
    subsidyMax: 55000,
    rateAnnual: 0.0425,
  },
  {
    id: "urbano_2",
    label: "Faixa Urbano 2",
    maxIncome: 4400,
    maxPropertyValue: 264000,
    subsidyMax: 29000,
    rateAnnual: 0.0525,
  },
  {
    id: "urbano_3",
    label: "Faixa Urbano 3",
    maxIncome: 8000,
    maxPropertyValue: 350000,
    subsidyMax: 0,
    rateAnnual: 0.0816,
  },
]);

export type McmvInput = {
  /** Renda bruta mensal familiar em BRL. */
  renda: number;
  /** Primeiro imóvel? (MCMV exige). */
  primeiroImovel?: boolean;
};

export type McmvResult =
  | { eligible: true; band: McmvBand }
  | { eligible: false; band: null; reason: "renda_acima_teto" | "nao_primeiro_imovel" | "renda_invalida" };

/**
 * Retorna a faixa MCMV do lead com base na renda.  Regra: menor faixa
 * cujo teto de renda ≥ renda do lead.
 *
 * Invariant: MCMV_BANDS é readonly — ordem crescente de maxIncome.
 */
export function mcmvBand(input: McmvInput): McmvResult {
  if (!Number.isFinite(input.renda) || input.renda <= 0) {
    return { eligible: false, band: null, reason: "renda_invalida" };
  }
  if (input.primeiroImovel === false) {
    return { eligible: false, band: null, reason: "nao_primeiro_imovel" };
  }
  for (const band of MCMV_BANDS) {
    if (input.renda <= band.maxIncome) {
      return { eligible: true, band };
    }
  }
  return { eligible: false, band: null, reason: "renda_acima_teto" };
}

// ──────────────────────────────────────────────────────────────────────
// FGTS — regras básicas de uso no SFH
// ──────────────────────────────────────────────────────────────────────

export type FgtsInput = {
  /** Tempo acumulado de CLT em meses. Regra: ≥ 36 meses (não precisa ser consecutivos). */
  monthsClt: number;
  /** Único imóvel a ser adquirido? (SFH exige). */
  isFirstHome: boolean;
  /** Valor do imóvel em BRL. Teto SFH 2024: R$ 1.500.000. */
  propertyValue?: number;
};

export type FgtsResult =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "tempo_clt_insuficiente"
        | "nao_primeiro_imovel"
        | "imovel_acima_teto_sfh";
    };

export const FGTS_SFH_CEILING = 1_500_000;
export const FGTS_MIN_MONTHS_CLT = 36;

export function fgtsEligible(input: FgtsInput): FgtsResult {
  if (input.monthsClt < FGTS_MIN_MONTHS_CLT) {
    return { eligible: false, reason: "tempo_clt_insuficiente" };
  }
  if (!input.isFirstHome) {
    return { eligible: false, reason: "nao_primeiro_imovel" };
  }
  if (input.propertyValue != null && input.propertyValue > FGTS_SFH_CEILING) {
    return { eligible: false, reason: "imovel_acima_teto_sfh" };
  }
  return { eligible: true };
}

// ──────────────────────────────────────────────────────────────────────
// ITBI — cálculo simples
// ──────────────────────────────────────────────────────────────────────

/**
 * ITBI = valor · (rateBps / 10000). Ex.: 2% = 200 bps.
 * rateBps vem do `cities_fiscal` (Slice 3.2) ou do default
 * `finance_itbi_default_bps` em system_settings.
 */
export function itbi(value: number, rateBps: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("itbi: valor inválido");
  }
  if (!Number.isFinite(rateBps) || rateBps < 0) {
    throw new Error("itbi: rateBps inválido");
  }
  return round2((value * rateBps) / 10000);
}

// ──────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────

function validateAmortInput(input: AmortizationInput): void {
  if (!Number.isFinite(input.principal) || input.principal <= 0) {
    throw new Error("principal deve ser > 0");
  }
  if (!Number.isFinite(input.rateAnnual) || input.rateAnnual < 0) {
    throw new Error("rateAnnual deve ser ≥ 0");
  }
  if (!Number.isInteger(input.months) || input.months <= 0) {
    throw new Error("months deve ser inteiro > 0");
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
