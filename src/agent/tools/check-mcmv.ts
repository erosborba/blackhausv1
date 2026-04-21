/**
 * Agent tool: check_mcmv — Track 3 · Slice 3.4 + 3.5a.
 *
 * Wrapper com side-effect. Lê config de `system_settings` (via
 * `getFinanceConfig`) e delega pra função pura `computeMcmvResponse`
 * (em `src/lib/mcmv-response.ts`), que é testável standalone.
 *
 * **Modo copilot** (3.5a, default): quando `finance_mcmv_mode='copilot'`,
 * a resposta elegível NÃO volta pra Bia — é persistida como
 * `copilot_suggestion` pra corretor revisar no /inbox e enviar. Bia
 * recebe só um texto-promessa. MCMV é menos arriscado que simulação
 * (faixas são públicas) mas "primeiro imóvel" tem definição legal que
 * vale o humano confirmar com o lead.
 *
 * Quando `pure.ok=false` (renda inválida, precisa perguntar primeiro
 * imóvel, acima do teto), passa direto — são perguntas da Bia pro
 * lead, sem número de parcela/subsídio vinculante.
 *
 * Invariants:
 *   - I-6: determinismo. Toda lógica em função pura testável.
 *   - I-4: a parte testável (`computeMcmvResponse`) não depende de
 *     banco/env; só este wrapper toca o mundo.
 *   - **Safety**: em copilot mode, o output de sucesso NÃO contém a
 *     `band` estruturada — Bia não consegue vazar subsídio/taxa.
 */
import { getFinanceConfig, type FinanceConfig } from "@/lib/finance-config";
import {
  computeMcmvResponse,
  type McmvResponse,
  type McmvResponseOk,
  type McmvResponseFail,
} from "@/lib/mcmv-response";
import { insertCopilotSuggestion } from "@/lib/copilot-suggestions";
import { buildCopilotPromise } from "@/lib/copilot-promise";

export type CheckMcmvInput = {
  /** Renda bruta mensal familiar em BRL. Obrigatório. */
  renda: number;
  /** Se o lead declarou que é o primeiro imóvel. Default undefined = não perguntado. */
  primeiro_imovel?: boolean;
  /** Nome opcional do lead pra personalizar o texto. */
  nome?: string | null;
  /**
   * Lead id. Obrigatório em modo copilot (pra persistir a sugestão).
   * Em modo direct é opcional.
   */
  lead_id?: string;
  /**
   * Override de config (testes/admin). Em produção sempre undefined —
   * a tool lê do system_settings.
   */
  _config?: FinanceConfig;
  /** Injeção de `now` pra testes. */
  _now?: Date;
};

export type CheckMcmvDirectOutput = McmvResponseOk & { mode: "direct" };

export type CheckMcmvCopilotOutput = {
  ok: true;
  mode: "copilot";
  suggestion_id: string;
  /** Texto-promessa pro Bia mandar (sem números/faixa). */
  text: string;
};

export type CheckMcmvMissingLeadOutput = {
  ok: false;
  reason: "missing_lead_id";
  text: string;
};

export type CheckMcmvOutput =
  | CheckMcmvDirectOutput
  | CheckMcmvCopilotOutput
  | McmvResponseFail
  | CheckMcmvMissingLeadOutput;

export async function checkMcmv(
  input: CheckMcmvInput,
): Promise<CheckMcmvOutput> {
  const config = input._config ?? (await getFinanceConfig());

  const pure: McmvResponse = computeMcmvResponse(
    {
      renda: input.renda,
      primeiro_imovel: input.primeiro_imovel,
      nome: input.nome,
    },
    { mcmvEnabled: config.flags.mcmvEnabled },
  );

  // Fail passa direto — são perguntas/redirecionamentos sem número
  // comprometedor.
  if (!pure.ok) return pure;

  if (config.flags.mcmvMode === "direct") {
    return { ...pure, mode: "direct" };
  }

  // ── Modo copilot ──────────────────────────────────────────────────
  if (!input.lead_id) {
    console.error(
      "[check-mcmv] copilot mode exige lead_id; caller esqueceu",
    );
    return {
      ok: false,
      reason: "missing_lead_id",
      text: "Preciso te identificar antes de alinhar a elegibilidade com o consultor. Me confirma seu nome/telefone?",
    };
  }

  const suggestion_id = await insertCopilotSuggestion({
    leadId: input.lead_id,
    kind: "mcmv",
    payload: {
      band: pure.band,
      source_date: pure.source_date,
      renda: input.renda,
      primeiro_imovel: input.primeiro_imovel,
    },
    textPreview: pure.text,
    meta: { band_id: pure.band.id },
  });

  const now = input._now ?? new Date();
  const promiseText = buildCopilotPromise({
    now,
    kind: "mcmv",
    nome: input.nome,
  });

  return {
    ok: true,
    mode: "copilot",
    suggestion_id,
    text: promiseText,
  };
}
