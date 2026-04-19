import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "./env";

let _model: ChatAnthropic | null = null;

export function chatModel(temperature = 0.4) {
  if (_model) return _model;
  _model = new ChatAnthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL,
    temperature,
    maxTokens: 1024,
  });
  // @langchain/anthropic default topP/topK=-1 e Claude 4.x rejeita.
  // Sobrescrevemos pra undefined para que o SDK omita do request.
  (_model as unknown as { topP: unknown; topK: unknown }).topP = undefined;
  (_model as unknown as { topP: unknown; topK: unknown }).topK = undefined;
  return _model;
}
