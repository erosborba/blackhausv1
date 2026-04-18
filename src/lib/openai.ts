import OpenAI from "openai";
import { env } from "./env";

let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

export async function embed(text: string): Promise<number[]> {
  const r = await openai().embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: text,
  });
  return r.data[0].embedding;
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const r = await openai().embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts,
  });
  return r.data.map((d) => d.embedding);
}
