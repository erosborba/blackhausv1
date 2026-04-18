import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { Qualification } from "@/lib/leads";

export type Intent =
  | "saudacao"
  | "duvida_empreendimento"
  | "qualificar"
  | "agendar"
  | "fora_de_escopo"
  | "handoff_humano";

export type Stage = "greet" | "discover" | "qualify" | "recommend" | "schedule" | "handoff";

export const SDRState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  leadId: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  phone: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  pushName: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  qualification: Annotation<Qualification>({
    reducer: (cur, n) => ({ ...cur, ...n }),
    default: () => ({}),
  }),
  intent: Annotation<Intent | null>({ reducer: (_, n) => n, default: () => null }),
  stage: Annotation<Stage>({ reducer: (_, n) => n, default: () => "greet" }),
  missingFields: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),
  retrieved: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  reply: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  needsHandoff: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
});

export type SDRStateType = typeof SDRState.State;
