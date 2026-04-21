/**
 * Agent tool: simulate_financing — Track 3 · Slice 3.3.
 *
 * Wrapper com side-effect: lê config de `system_settings` via
 * `getFinanceConfig()` e delega pra `computeSimulationResponse` (pura).
 *
 * **Guardrail**: por padrão (`finance_require_explicit_price=true`), a
 * Bia só simula com preço vindo do lead ou de `preco_inicial` do
 * empreendimento. Se `price_source` não for informado, retorna
 * `{ok:false, reason:'needs_price'}` e Bia pergunta.
 *
 * Invariants:
 *   - I-6: determinismo. Lógica delegada pra funções puras.
 *   - I-4: a parte testável (`computeSimulationResponse`) não depende
 *     de banco/env; só este wrapper toca o mundo.
 */
import { getFinanceConfig, type FinanceConfig } from "@/lib/finance-config";
import {
  computeSimulationResponse,
  type SimulationInputData,
  type SimulationResponse,
} from "@/lib/simulation-response";

export type SimulateFinancingInput = SimulationInputData & {
  /**
   * Override de config (pra testes/admin). Em produção sempre
   * undefined — a tool lê do system_settings.
   */
  _config?: FinanceConfig;
};

export type SimulateFinancingOutput = SimulationResponse;

export async function simulateFinancing(
  input: SimulateFinancingInput,
): Promise<SimulateFinancingOutput> {
  const config = input._config ?? (await getFinanceConfig());
  return computeSimulationResponse(
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
}
