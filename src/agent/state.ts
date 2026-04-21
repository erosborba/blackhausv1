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
  /**
   * Compactação de turnos antigos (Fatia Tier 2 #4).
   *
   * Quando `messages` cresce além do threshold, o `compactNode` gera aqui
   * um resumo denso (Haiku) dos turnos mais antigos. Router/answerNode
   * passam a ver só os últimos K turnos literais + esse resumo, mantendo
   * o prompt bounded sem perder continuidade.
   *
   * Diferente de `leadMemory` (cross-session, prose geral sobre o lead):
   *   - leadMemory: "quem é esse lead, o que ele busca" — atualizada off-graph
   *   - compactedHistory: "o que aconteceu nos últimos X turnos desta sessão"
   */
  compactedHistory: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  /**
   * Handoff estruturado (Tier 3 #2). Preenchidos pelo router quando
   * intent=handoff_humano ou quando o grafo/factcheck sinaliza escalar.
   * Persistidos em `leads.handoff_reason` / `leads.handoff_urgency`
   * pra triagem do corretor e analytics no /admin/funnel.
   *
   * Taxonomia fixa — ver CHECK constraint na migration 20260420000009.
   */
  handoffReason: Annotation<HandoffReason | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  handoffUrgency: Annotation<HandoffUrgency | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});

export type HandoffReason =
  | "lead_pediu_humano"
  | "fora_de_escopo"
  | "objecao_complexa"
  | "ia_incerta"
  | "urgencia_alta"
  | "escalacao"
  | "outro";

export type HandoffUrgency = "baixa" | "media" | "alta";

/** Copy canônica pra exibir no admin/notificação do corretor. */
export const HANDOFF_REASON_LABEL: Record<HandoffReason, string> = {
  lead_pediu_humano: "Lead pediu humano",
  fora_de_escopo: "Fora de escopo",
  objecao_complexa: "Objeção complexa (preço/prazo)",
  ia_incerta: "IA incerta — precisa confirmar",
  urgencia_alta: "Urgência alta",
  escalacao: "Escalação (corretor não respondeu)",
  outro: "Outro",
};

export const HANDOFF_URGENCY_EMOJI: Record<HandoffUrgency, string> = {
  baixa: "🟢",
  media: "🟡",
  alta: "🔴",
};

export type SDRStateType = typeof SDRState.State;
