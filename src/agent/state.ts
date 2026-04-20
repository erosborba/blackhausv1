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
  /**
   * Confiança do retrieval semântico no turno atual:
   *   - "strong": há chunks claramente relacionados (topScore ≥ threshold)
   *   - "weak":   chunks foram retornados mas score baixo → Bia deve escalar
   *   - "none":   nenhum chunk / retrieval não foi executado / fallback bruto
   *
   * Usado pelo answerNode pra saber se deve responder dúvida específica
   * com o contexto recuperado ou dizer que vai confirmar com consultor.
   */
  retrievedConfidence: Annotation<"strong" | "weak" | "none">({
    reducer: (_, n) => n,
    default: () => "none",
  }),
  reply: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  needsHandoff: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  /** Dicas ocultas do corretor (human-in-the-loop). Injetadas no system prompt. */
  agentNotes: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  /**
   * Memória persistente do lead (prose, ~200-300 palavras) — resumo do que
   * a Bia já aprendeu sobre o cliente. Atualizada em background por Haiku
   * (ver `src/lib/lead-memory.ts`). Injetada nos prompts do router e answer.
   */
  leadMemory: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
});

export type SDRStateType = typeof SDRState.State;
