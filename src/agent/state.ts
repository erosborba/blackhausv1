import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { Qualification } from "@/lib/leads";
import type { HandoffReason, HandoffUrgency } from "@/lib/handoff-copy";
import type { RetrievedSource } from "./retrieval";
import type { FotoCategoria } from "@/lib/empreendimentos-shared";

export type Intent =
  | "saudacao"
  | "duvida_empreendimento"
  | "qualificar"
  | "agendar"
  | "fora_de_escopo"
  | "handoff_humano";

export type Stage = "greet" | "discover" | "qualify" | "recommend" | "schedule" | "handoff";

/**
 * Sinal estruturado emitido pelo router quando o lead pede mídia explicitamente.
 *  - "fotos":   "manda foto", "quero ver a fachada", "me mostra o decorado"
 *  - "booking": "manda o book/apresentação/material"
 *  - null:      nenhum pedido explícito
 *
 * Quem consome: `mediaNode` depois do answerNode, pra disparar as tools
 * `sendEmpreendimentoFotos` / `sendEmpreendimentoBooking` fire-and-forget.
 */
export type MediaIntent = "fotos" | "booking" | null;

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
   * Empreendimentos citados no retrieval do turno atual. Gravado em
   * `messages.sources` quando o answerNode produz resposta — permite a UI
   * exibir pills "📎 Empreendimento X" abaixo do bubble da Bia.
   */
  retrievedSources: Annotation<RetrievedSource[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  /**
   * Score 0-100 calculado pelo router a cada turno (fit + stage + engagement
   * + urgency — ver `@/lib/lead-score`). Persistido em `leads.score` pelo
   * webhook. Usado pro Priority Rail e pra ordenação do inbox.
   */
  score: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
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
  /**
   * Pedido explícito de mídia detectado pelo router. Quando ≠ null, o
   * mediaNode dispara envio de fotos/booking do primeiro `retrievedSources`
   * depois que a resposta de texto sai. Null = nenhum envio.
   */
  mediaIntent: Annotation<MediaIntent>({ reducer: (_, n) => n, default: () => null }),
  /**
   * Categoria de foto inferida quando mediaIntent="fotos". Null = mix
   * automático (fachada/decorado/lazer priorizados).
   */
  mediaCategoria: Annotation<FotoCategoria | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});

/**
 * Tipos e copy de handoff foram extraídos pra `@/lib/handoff-copy` (puro,
 * sem deps server-only) pra que o UI client possa importar sem arrastar
 * LangGraph/SDK. Re-exportamos aqui pra manter imports existentes funcionando.
 */
export {
  HANDOFF_REASON_LABEL,
  HANDOFF_REASON_ORDER,
  HANDOFF_URGENCY_EMOJI,
  HANDOFF_URGENCY_ORDER,
  HANDOFF_URGENCY_TONE,
  type HandoffReason,
  type HandoffUrgency,
} from "@/lib/handoff-copy";

export type SDRStateType = typeof SDRState.State;
