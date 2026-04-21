import { supabaseAdmin } from "./supabase";

/**
 * Telemetria de uso AI (Fatia F).
 *
 * Cada chamada a Claude/OpenAI passa por `logUsage` pra registrar token,
 * custo em USD e duração. A tabela `ai_usage_log` serve de fonte pro
 * dashboard em /admin/usage.
 *
 * O logging é SEMPRE fire-and-forget: se gravar no Supabase falhar, a gente
 * só loga no console e não propaga — telemetria quebrada não pode derrubar
 * a feature principal.
 */

// ---------------------------------------------------------------------------
// Tasks e providers
// ---------------------------------------------------------------------------

export type Provider = "anthropic" | "openai";

/**
 * Tasks canônicas. Mantém como union string aqui pra IDE autocompletar,
 * mas o banco aceita qualquer string (flexível pra novas features sem migrar).
 */
export type AiTask =
  | "extract"            // Claude lendo docs → structured fields
  | "faq_suggest"        // Claude propondo FAQs
  | "copilot"            // Claude no painel do corretor
  | "brief"              // Claude gerando resumo de lead
  | "bia_router"         // LangChain routerNode (classificação)
  | "bia_answer"         // LangChain answerNode (resposta final)
  | "rag_embed_chunks"   // OpenAI embedMany (indexação)
  | "rag_embed_query"    // OpenAI embed (pergunta do lead)
  | "lead_memory"        // Haiku mantendo a memória persistente do lead
  | "followup_message"   // Haiku gerando mensagem de nurturing
  | "audio_transcribe"   // OpenAI Whisper transcrevendo áudio do lead
  | "image_vision"       // Claude vision descrevendo imagem do lead
  | "context_compact";   // Haiku resumindo turnos antigos no grafo SDR

// ---------------------------------------------------------------------------
// Pricing table (USD por 1M tokens)
// ---------------------------------------------------------------------------
//
// Fonte:
//   https://www.anthropic.com/pricing
//   https://openai.com/api/pricing/
//
// Atualizar aqui sempre que o provedor mudar a tabela. Linhas antigas no banco
// ficam com o preço da época (não recalculamos retroativamente).

type AnthropicPrice = {
  input: number;         // USD/M tokens
  output: number;        // USD/M tokens
  cacheWrite: number;    // USD/M tokens (cache creation)
  cacheRead: number;     // USD/M tokens (cache hit)
};

type OpenAIPrice = {
  input: number;         // USD/M tokens
  output?: number;       // embeddings não tem output
};

const ANTHROPIC_PRICING: Record<string, AnthropicPrice> = {
  // Claude 4.6 Sonnet
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  // Fallback: Haiku mais barato — se aparecer algum modelo não listado, presume Haiku
  // pra não superestimar custo (alerta será se o log tiver cost 0 ou baixo demais).
  "claude-haiku-4-5": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
};

const OPENAI_PRICING: Record<string, OpenAIPrice> = {
  "text-embedding-3-small": { input: 0.02 },
  "text-embedding-3-large": { input: 0.13 },
};

/**
 * Calcula custo em USD. Se modelo desconhecido, retorna 0 e loga warning
 * (melhor ter registro sem custo do que perder a chamada inteira).
 */
export function computeCostUsd(
  provider: Provider,
  model: string,
  tokens: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
): number {
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;

  if (provider === "anthropic") {
    // Match exato primeiro, depois prefixo (ex.: "claude-sonnet-4-6-20260101" → "claude-sonnet-4-6")
    const price = pickPrice(ANTHROPIC_PRICING, model);
    if (!price) {
      console.warn(`[ai-usage] pricing desconhecido pra Anthropic model=${model}; custo=0`);
      return 0;
    }
    const usd =
      (input * price.input +
        output * price.output +
        cacheWrite * price.cacheWrite +
        cacheRead * price.cacheRead) /
      1_000_000;
    return round6(usd);
  }

  if (provider === "openai") {
    const price = pickPrice(OPENAI_PRICING, model);
    if (!price) {
      console.warn(`[ai-usage] pricing desconhecido pra OpenAI model=${model}; custo=0`);
      return 0;
    }
    const usd = ((input * price.input) + (output * (price.output ?? 0))) / 1_000_000;
    return round6(usd);
  }

  return 0;
}

function pickPrice<T>(table: Record<string, T>, model: string): T | null {
  if (table[model]) return table[model];
  // Tenta prefix (ex.: API da Anthropic retorna `claude-sonnet-4-6-20260101`)
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (model.startsWith(k)) return table[k];
  }
  return null;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// logUsage — entrypoint único
// ---------------------------------------------------------------------------

export type LogUsageInput = {
  provider: Provider;
  model: string;
  task: AiTask | string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  empreendimentoId?: string | null;
  leadId?: string | null;
  ok?: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Custo fixo em USD, calculado fora de `computeCostUsd`. Use pra modelos
   * cujo pricing não é token-based (ex.: Whisper = $/segundo). Se setado,
   * sobrescreve o cálculo por tabela de preço — o campo `cost_usd` do log
   * passa a refletir esse valor e o dashboard agrega corretamente.
   */
  costUsdOverride?: number;
};

/**
 * Registra uma linha em `ai_usage_log`. Fire-and-forget — chame sem await e
 * tudo bem. Erros ficam só no console.
 *
 * Exemplo:
 *   const t0 = Date.now();
 *   const r = await anthropic.messages.create({ ... });
 *   logUsage({
 *     provider: "anthropic",
 *     model: env.ANTHROPIC_MODEL,
 *     task: "extract",
 *     inputTokens: r.usage?.input_tokens,
 *     outputTokens: r.usage?.output_tokens,
 *     cacheReadTokens: r.usage?.cache_read_input_tokens,
 *     cacheWriteTokens: r.usage?.cache_creation_input_tokens,
 *     durationMs: Date.now() - t0,
 *     empreendimentoId: id,
 *   });
 */
export function logUsage(input: LogUsageInput): void {
  // Wrap em setTimeout(0) pra não segurar o event loop do caller.
  // (Em Next.js route handlers isso importa pra TTFB.)
  setTimeout(() => {
    void logUsageInternal(input);
  }, 0);
}

async function logUsageInternal(input: LogUsageInput): Promise<void> {
  try {
    const cost =
      typeof input.costUsdOverride === "number"
        ? round6(input.costUsdOverride)
        : computeCostUsd(input.provider, input.model, {
            input: input.inputTokens,
            output: input.outputTokens,
            cacheRead: input.cacheReadTokens,
            cacheWrite: input.cacheWriteTokens,
          });

    const sb = supabaseAdmin();
    const { error } = await sb.from("ai_usage_log").insert({
      provider: input.provider,
      model: input.model,
      task: input.task,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      cache_read_tokens: input.cacheReadTokens ?? 0,
      cache_write_tokens: input.cacheWriteTokens ?? 0,
      cost_usd: cost,
      duration_ms: input.durationMs ?? 0,
      empreendimento_id: input.empreendimentoId ?? null,
      lead_id: input.leadId ?? null,
      ok: input.ok ?? true,
      error: input.error ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error("[ai-usage] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[ai-usage] logUsage threw:", e);
  }
}

// ---------------------------------------------------------------------------
// Helpers pra extrair tokens das responses
// ---------------------------------------------------------------------------

/**
 * Extrai contagem de tokens de uma response do SDK @anthropic-ai/sdk.
 * Campo `usage` tem: input_tokens, output_tokens, cache_creation_input_tokens,
 * cache_read_input_tokens.
 */
export function anthropicUsage(resp: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}): {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
} {
  const u = resp.usage ?? {};
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
  };
}

/**
 * Extrai tokens de um AIMessage da LangChain (ChatAnthropic).
 * LangChain expõe `usage_metadata` normalizado (input_tokens, output_tokens,
 * input_token_details.cache_read, etc.) e mantém o raw em `response_metadata.usage`.
 */
export function langchainAnthropicUsage(msg: {
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: {
      cache_read?: number;
      cache_creation?: number;
    };
  };
  response_metadata?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
  };
}): {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
} {
  // Preferência: response_metadata.usage (raw da Anthropic, mais completo)
  const raw = msg.response_metadata?.usage;
  if (raw) {
    return {
      inputTokens: raw.input_tokens ?? 0,
      outputTokens: raw.output_tokens ?? 0,
      cacheWriteTokens: raw.cache_creation_input_tokens ?? 0,
      cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    };
  }
  // Fallback: usage_metadata normalizado
  const um = msg.usage_metadata;
  if (um) {
    return {
      inputTokens: um.input_tokens ?? 0,
      outputTokens: um.output_tokens ?? 0,
      cacheWriteTokens: um.input_token_details?.cache_creation ?? 0,
      cacheReadTokens: um.input_token_details?.cache_read ?? 0,
    };
  }
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

/**
 * Extrai tokens de uma response OpenAI embeddings (total_tokens).
 * Embeddings não têm output_tokens separado — tudo conta como input.
 */
export function openaiEmbedUsage(resp: {
  usage?: { total_tokens?: number; prompt_tokens?: number };
}): { inputTokens: number } {
  const u = resp.usage ?? {};
  return { inputTokens: u.total_tokens ?? u.prompt_tokens ?? 0 };
}
