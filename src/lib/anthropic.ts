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
  return _model;
}
