/**
 * Agent tool: check_mcmv — Track 3 · Slice 3.4.
 *
 * Wrapper com side-effect. Lê config de `system_settings` (via
 * `getFinanceConfig`) e delega pra função pura
 * `computeMcmvResponse` (em `src/lib/mcmv-response.ts`), que é
 * testável standalone.
 *
 * Uso: chamar server-side quando o lead declarar renda. A Bia usa o
 * `text` direto; o `band` estruturado vai pro state (pro copilot ou
 * pra informar `simulate_financing` do teto relevante).
 *
 * Gated por `finance_enabled` + `finance_mcmv_enabled` em
 * `system_settings`. Se desligado, retorna `{ ok:false, reason:'mcmv_disabled' }`.
 *
 * Invariants:
 *   - I-6: determinismo. Toda lógica em função pura testável.
 *   - I-4: a parte testável (`computeMcmvResponse`) não depende de
 *     banco/env; só este wrapper toca o mundo.
 */
import { getFinanceConfig, type FinanceConfig } from "@/lib/finance-config";
import {
  computeMcmvResponse,
  type McmvResponse,
} from "@/lib/mcmv-response";

export type CheckMcmvInput = {
  /** Renda bruta mensal familiar em BRL. Obrigatório. */
  renda: number;
  /** Se o lead declarou que é o primeiro imóvel. Default undefined = não perguntado. */
  primeiro_imovel?: boolean;
  /** Nome opcional do lead pra personalizar o texto. */
  nome?: string | null;
  /**
   * Override de config (pra testes/admin). Em produção sempre
   * undefined — a tool lê do system_settings.
   */
  _config?: FinanceConfig;
};

export type CheckMcmvOutput = McmvResponse;

export async function checkMcmv(input: CheckMcmvInput): Promise<CheckMcmvOutput> {
  const config = input._config ?? (await getFinanceConfig());
  return computeMcmvResponse(
    {
      renda: input.renda,
      primeiro_imovel: input.primeiro_imovel,
      nome: input.nome,
    },
    { mcmvEnabled: config.flags.mcmvEnabled },
  );
}
