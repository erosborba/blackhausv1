/**
 * Vanguard · Track 3 · Slice 3.3 — função pura que monta a resposta de
 * `simulate_financing`.
 *
 * Padrão split: o wrapper com side-effect (lê config) vive em
 * `src/agent/tools/simulate-financing.ts` e chama esta função depois
 * de montar defaults e flags.  Aqui só matemática + texto.
 *
 * **Guardrail central** (decisão 2026-04-24): se
 * `flags.requireExplicitPrice=true` e o preço NÃO veio do lead nem do
 * empreendimento (preco_inicial), retorna `needs_price`.  Bia pergunta
 * em vez de chutar.  Isso é o que separa calculadora de oráculo
 * mentiroso.
 */
import { sbpe, sac, type AmortizationSystem } from "./finance.ts";

export type SimulationPriceSource = "lead" | "empreendimento" | "none";

export type SimulationFlagsSubset = {
  simulateEnabled: boolean;
  requireExplicitPrice: boolean;
};

export type SimulationInputData = {
  /** Valor total do imóvel em BRL. */
  preco_imovel: number;
  /** Valor da entrada em BRL. Se ausente, usa `default_entry_pct` * preco. */
  entrada?: number;
  /** Prazo em meses. Se ausente, usa `default_term_months`. */
  prazo_meses?: number;
  /** Sistema de amortização. Default 'sbpe'. */
  sistema?: AmortizationSystem;
  /** Taxa anual em decimal. Ex.: 0.115 = 11.5%. Default = defaults.sbpeRateAnnual. */
  taxa_anual?: number;
  /**
   * Origem do preço — decide se o guardrail trava ou não.
   *   - 'lead': lead declarou o valor. OK.
   *   - 'empreendimento': veio de `preco_inicial` do DB. OK (rotulado "a partir de").
   *   - 'none' (ou ausente): sem origem confiável. Bloqueia se requireExplicitPrice=true.
   */
  price_source?: SimulationPriceSource;
  /** Nome opcional do lead pra personalizar o texto. */
  nome?: string | null;
};

export type SimulationDefaults = {
  entryPct: number;
  termMonths: number;
  sbpeRateAnnual: number;
};

export type SimulationResponseOk = {
  ok: true;
  sistema: AmortizationSystem;
  preco_imovel: number;
  entrada: number;
  /** Valor financiado = preco − entrada. */
  principal: number;
  prazo_meses: number;
  taxa_anual: number;
  parcela_inicial: number;
  parcela_final: number;
  /** Soma total paga = entrada + soma das parcelas. */
  total_pago: number;
  total_juros: number;
  /** Texto pronto em pt-BR pra Bia colar. */
  text: string;
  /** Propagado pro caller decidir se cola rótulo "a partir de". */
  price_source: SimulationPriceSource;
};

export type SimulationResponseFail = {
  ok: false;
  reason:
    | "simulate_disabled"
    | "needs_price"
    | "preco_invalido"
    | "prazo_invalido"
    | "entrada_invalida"
    | "entrada_maior_que_preco";
  text: string;
};

export type SimulationResponse = SimulationResponseOk | SimulationResponseFail;

export function computeSimulationResponse(
  input: SimulationInputData,
  flags: SimulationFlagsSubset,
  defaults: SimulationDefaults,
): SimulationResponse {
  if (!flags.simulateEnabled) {
    return {
      ok: false,
      reason: "simulate_disabled",
      text: "Simulação de financiamento tá desativada no momento. Vou pedir pro corretor te passar os números.",
    };
  }

  // ── Guardrail de preço ──────────────────────────────────────────────
  // Se o admin exigir preço explícito (default), o caller DEVE passar
  // price_source. Sem origem confiável, Bia pergunta ao lead.
  const priceSource = input.price_source ?? "none";
  if (flags.requireExplicitPrice && priceSource === "none") {
    return {
      ok: false,
      reason: "needs_price",
      text: "Pra simular com precisão, me passa o valor do imóvel que você quer avaliar? (Pode ser aproximado.)",
    };
  }

  if (!Number.isFinite(input.preco_imovel) || input.preco_imovel <= 0) {
    return {
      ok: false,
      reason: "preco_invalido",
      text: "O valor do imóvel precisa ser maior que zero. Me passa um valor aproximado que eu simulo.",
    };
  }

  const prazo = input.prazo_meses ?? defaults.termMonths;
  if (!Number.isInteger(prazo) || prazo <= 0) {
    return {
      ok: false,
      reason: "prazo_invalido",
      text: "O prazo precisa ser em meses (ex.: 360 = 30 anos). Me passa o prazo que você quer.",
    };
  }

  const entrada = input.entrada ?? Math.round(input.preco_imovel * (defaults.entryPct / 100));
  if (!Number.isFinite(entrada) || entrada < 0) {
    return {
      ok: false,
      reason: "entrada_invalida",
      text: "A entrada precisa ser um valor válido (pode ser zero, mas não negativo).",
    };
  }
  if (entrada >= input.preco_imovel) {
    return {
      ok: false,
      reason: "entrada_maior_que_preco",
      text: "A entrada tá maior ou igual ao valor do imóvel — aí não precisa financiar nada. Quer revisar os números?",
    };
  }

  const principal = input.preco_imovel - entrada;
  const taxa = input.taxa_anual ?? defaults.sbpeRateAnnual;
  const sistema = input.sistema ?? "sbpe";

  const amort =
    sistema === "sac"
      ? sac({ principal, rateAnnual: taxa, months: prazo })
      : sbpe({ principal, rateAnnual: taxa, months: prazo });

  const totalPago = round2(entrada + amort.totalPaid);

  return {
    ok: true,
    sistema,
    preco_imovel: input.preco_imovel,
    entrada,
    principal: round2(principal),
    prazo_meses: prazo,
    taxa_anual: taxa,
    parcela_inicial: amort.firstPayment,
    parcela_final: amort.lastPayment,
    total_pago: totalPago,
    total_juros: amort.totalInterest,
    text: buildText({
      sistema,
      preco: input.preco_imovel,
      entrada,
      prazo,
      taxa,
      parcelaInicial: amort.firstPayment,
      parcelaFinal: amort.lastPayment,
      totalJuros: amort.totalInterest,
      priceSource,
      nome: input.nome ?? null,
    }),
    price_source: priceSource,
  };
}

type TextInput = {
  sistema: AmortizationSystem;
  preco: number;
  entrada: number;
  prazo: number;
  taxa: number;
  parcelaInicial: number;
  parcelaFinal: number;
  totalJuros: number;
  priceSource: SimulationPriceSource;
  nome: string | null;
};

/**
 * Texto pt-BR pronto pro WhatsApp. Estrutura:
 *   1. Linha de contexto: valor + entrada + prazo + sistema + taxa
 *   2. Resultado principal: parcela (constante ou range SAC) + juros totais
 *   3. Rodapé: ressalva de custos não inclusos + próximo passo
 *
 * Se `priceSource='empreendimento'`, cola "a partir de" no valor —
 * o lead entende que a unidade específica pode variar.
 */
function buildText(t: TextInput): string {
  const nome = t.nome ? `${t.nome}, ` : "";
  const precoPrefix = t.priceSource === "empreendimento" ? "a partir de " : "";
  const entradaPct = Math.round((t.entrada / t.preco) * 100);
  const taxaTxt = (t.taxa * 100).toFixed(2).replace(".", ",");
  const anos = Math.round(t.prazo / 12);

  const linha1 = `${nome}simulação pra imóvel ${precoPrefix}${fmtBRL(t.preco)} com ${fmtBRL(t.entrada)} de entrada (${entradaPct}%), ${anos} anos no ${t.sistema.toUpperCase()} a ${taxaTxt}% a.a.`;

  const linha2 =
    t.sistema === "sac"
      ? `Parcela começa em ${fmtBRL(t.parcelaInicial)} e termina em ${fmtBRL(t.parcelaFinal)}. Total de juros: ${fmtBRL(t.totalJuros)}.`
      : `Parcela constante: ${fmtBRL(t.parcelaInicial)}. Total de juros: ${fmtBRL(t.totalJuros)}.`;

  const linha3 =
    t.sistema === "sac"
      ? "Não inclui condomínio, IPTU nem taxas do banco. Se preferir parcela fixa, me fala que simulo no SBPE."
      : "Não inclui condomínio, IPTU nem taxas do banco. Quer ver no SAC (parcela decrescente, dá menos juros no total)?";

  return `${linha1}\n\n${linha2}\n\n${linha3}`;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
