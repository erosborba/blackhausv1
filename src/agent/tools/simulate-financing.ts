/**
 * Agent tool: simulate_financing — Track 3 · Slice 3.3 + 3.5a.
 *
 * Wrapper com side-effect: lê config de `system_settings` via
 * `getFinanceConfig()` e delega pra `computeSimulationResponse` (pura).
 *
 * **Guardrail de preço** (3.3): por padrão (`finance_require_explicit_price=true`),
 * a Bia só simula com preço vindo do lead ou de `preco_inicial` do
 * empreendimento. Se `price_source` não for informado, retorna
 * `{ok:false, reason:'needs_price'}` e Bia pergunta.
 *
 * **Modo copilot** (3.5a, default): quando `finance_simulate_mode='copilot'`,
 * os números NÃO voltam pra Bia. O wrapper persiste uma
 * `copilot_suggestion` com o texto pronto + payload estruturado; a Bia
 * recebe só um texto-promessa ("vou puxar com o consultor e te
 * respondo em instantes"). Corretor revisa no /inbox e clica enviar.
 * Fail-closed: mesmo que Bia ignore o prompt, ela não tem acesso aos
 * números em copilot mode (o campo `numbers` não existe nessa variante).
 *
 * Invariants:
 *   - I-6: determinismo. Lógica de math delegada pra função pura.
 *   - I-4: a parte testável (`computeSimulationResponse`) não depende de
 *     banco/env; só este wrapper toca o mundo.
 *   - **Safety**: em copilot mode, o output de sucesso NÃO contém os
 *     números. Quem quiser ler, vai em `copilot_suggestions.payload`.
 */
import { getFinanceConfig, type FinanceConfig } from "@/lib/finance-config";
import {
  computeSimulationResponse,
  type SimulationInputData,
  type SimulationResponse,
  type SimulationResponseOk,
  type SimulationResponseFail,
  type SimulationPriceSource,
} from "@/lib/simulation-response";
import { insertCopilotSuggestion } from "@/lib/copilot-suggestions";
import { buildCopilotPromise } from "@/lib/copilot-promise";

export type SimulateFinancingInput = SimulationInputData & {
  /**
   * Lead id. Obrigatório em modo copilot (pra persistir a sugestão).
   * Em modo direct é opcional — usado apenas pra telemetria/logs.
   */
  lead_id?: string;
  /**
   * Override de config (testes/admin). Em produção sempre undefined —
   * a tool lê do system_settings.
   */
  _config?: FinanceConfig;
  /**
   * Injeção de `now` pra testes do texto-promessa. Em produção undefined.
   */
  _now?: Date;
};

/**
 * Resultado em modo direct: shape idêntica à função pura + discriminante
 * `mode: 'direct'` pra caller tipar exaustivamente.
 */
export type SimulateFinancingDirectOutput = SimulationResponseOk & {
  mode: "direct";
};

/**
 * Resultado em modo copilot. Intencionalmente sem os números — Bia
 * recebe só o texto-promessa; os números ficaram no DB (acessíveis via
 * `copilot_suggestions.payload`).
 */
export type SimulateFinancingCopilotOutput = {
  ok: true;
  mode: "copilot";
  suggestion_id: string;
  /** Texto-promessa pro Bia mandar ao lead (sem números). */
  text: string;
  price_source: SimulationPriceSource;
};

/**
 * Fail específico do wrapper — tool foi chamada em modo copilot sem
 * `lead_id`. Tratado como programming error loud, não runtime silencioso.
 */
export type SimulateFinancingMissingLeadOutput = {
  ok: false;
  reason: "missing_lead_id";
  text: string;
};

export type SimulateFinancingOutput =
  | SimulateFinancingDirectOutput
  | SimulateFinancingCopilotOutput
  | SimulationResponseFail
  | SimulateFinancingMissingLeadOutput;

export async function simulateFinancing(
  input: SimulateFinancingInput,
): Promise<SimulateFinancingOutput> {
  const config = input._config ?? (await getFinanceConfig());

  const pure: SimulationResponse = computeSimulationResponse(
    {
      preco_imovel: input.preco_imovel,
      entrada: input.entrada,
      prazo_meses: input.prazo_meses,
      sistema: input.sistema,
      taxa_anual: input.taxa_anual,
      price_source: input.price_source,
      nome: input.nome,
    },
    {
      simulateEnabled: config.flags.simulateEnabled,
      requireExplicitPrice: config.flags.requireExplicitPrice,
    },
    {
      entryPct: config.defaults.entryPct,
      termMonths: config.defaults.termMonths,
      sbpeRateAnnual: config.defaults.sbpeRateAnnual,
    },
  );

  // Fail (guardrail, input inválido) passa direto — são perguntas que
  // a Bia faz ao lead, sem número envolvido. Nenhum risco de vazamento.
  if (!pure.ok) return pure;

  if (config.flags.simulateMode === "direct") {
    return { ...pure, mode: "direct" };
  }

  // ── Modo copilot ──────────────────────────────────────────────────
  // Persiste sugestão com o texto pronto + payload. Bia recebe só a
  // promessa curta. Números NÃO voltam no output (fail-closed).
  if (!input.lead_id) {
    console.error(
      "[simulate-financing] copilot mode exige lead_id; caller esqueceu",
    );
    return {
      ok: false,
      reason: "missing_lead_id",
      text: "Preciso te identificar antes de montar os números. Me confirma seu nome/telefone?",
    };
  }

  const suggestion_id = await insertCopilotSuggestion({
    leadId: input.lead_id,
    kind: "simulation",
    payload: {
      sistema: pure.sistema,
      preco_imovel: pure.preco_imovel,
      entrada: pure.entrada,
      principal: pure.principal,
      prazo_meses: pure.prazo_meses,
      taxa_anual: pure.taxa_anual,
      parcela_inicial: pure.parcela_inicial,
      parcela_final: pure.parcela_final,
      total_pago: pure.total_pago,
      total_juros: pure.total_juros,
    },
    textPreview: pure.text,
    meta: { price_source: pure.price_source },
  });

  const now = input._now ?? new Date();
  const promiseText = buildCopilotPromise({
    now,
    kind: "simulation",
    nome: input.nome,
  });

  return {
    ok: true,
    mode: "copilot",
    suggestion_id,
    text: promiseText,
    price_source: pure.price_source,
  };
}
