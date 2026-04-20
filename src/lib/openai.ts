import OpenAI from "openai";
import { env } from "./env";
import { logUsage, openaiEmbedUsage } from "./ai-usage";

let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

/**
 * Embed 1 texto (tipicamente: pergunta do lead antes de bater no RAG).
 * Task = `rag_embed_query` no log de custo.
 */
export async function embed(text: string): Promise<number[]> {
  const t0 = Date.now();
  try {
    const r = await openai().embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: text,
    });
    const u = openaiEmbedUsage(r);
    logUsage({
      provider: "openai",
      model: env.OPENAI_EMBEDDING_MODEL,
      task: "rag_embed_query",
      inputTokens: u.inputTokens,
      durationMs: Date.now() - t0,
      metadata: { chars: text.length },
    });
    return r.data[0].embedding;
  } catch (e) {
    logUsage({
      provider: "openai",
      model: env.OPENAI_EMBEDDING_MODEL,
      task: "rag_embed_query",
      durationMs: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Embed em batch (reindex de empreendimento → N chunks de uma vez).
 * Task = `rag_embed_chunks`. Metadata carrega `chunk_count` pra saber se um
 * pico de custo veio de um memorial gigante.
 */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const t0 = Date.now();
  try {
    const r = await openai().embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: texts,
    });
    const u = openaiEmbedUsage(r);
    logUsage({
      provider: "openai",
      model: env.OPENAI_EMBEDDING_MODEL,
      task: "rag_embed_chunks",
      inputTokens: u.inputTokens,
      durationMs: Date.now() - t0,
      metadata: { chunk_count: texts.length },
    });
    return r.data.map((d) => d.embedding);
  } catch (e) {
    logUsage({
      provider: "openai",
      model: env.OPENAI_EMBEDDING_MODEL,
      task: "rag_embed_chunks",
      durationMs: Date.now() - t0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      metadata: { chunk_count: texts.length },
    });
    throw e;
  }
}
