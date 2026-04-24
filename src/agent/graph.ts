import { StateGraph, END, START } from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { createHash } from "node:crypto";
import {
  SDRState,
  type SDRStateType,
  type HandoffReason,
  type HandoffUrgency,
  type MediaIntent,
} from "./state";
import type { FotoCategoria } from "@/lib/empreendimentos-shared";
import {
  routerNode,
  retrieveNode,
  answerNode,
  handoffNode,
  compactNode,
  routeFromRouter,
} from "./nodes";
import type { RetrievedSource } from "./retrieval";
import type { Intent, Stage } from "./state";
import { checkpointer } from "@/lib/checkpointer";
import { recentMessages, type Lead, type Qualification } from "@/lib/leads";

let _compiled: Awaited<ReturnType<typeof build>> | null = null;

/**
 * Gera ID determinístico pra BaseMessage. Mesma (role, content, timestamp) →
 * mesmo ID. O `messagesStateReducer` do LangGraph faz dedup por ID; isso
 * garante que re-hidratações idempotentes não acumulem cópias no checkpoint.
 *
 * Trim no timestamp pra minutos (slice(0,16) = "YYYY-MM-DDTHH:MM") porque
 * inbound vem com created_at no segundo ou ms — qualquer reformatação não
 * deve invalidar a dedup. 16 chars já é específico o bastante pra não
 * colidir com mensagens diferentes da mesma sessão.
 */
function stableMessageId(role: string, content: string, isoTimestamp: string): string {
  const minute = isoTimestamp.slice(0, 16);
  const h = createHash("sha1").update(`${role}|${minute}|${content}`).digest("hex");
  return `msg-${h.slice(0, 16)}`;
}

async function build() {
  const saver = await checkpointer();

  const graph = new StateGraph(SDRState)
    .addNode("compact", compactNode)
    .addNode("router", routerNode)
    .addNode("retrieve", retrieveNode)
    .addNode("answer", answerNode)
    .addNode("handoff", handoffNode)
    // compactNode é o primeiro passo: se messages > threshold, resume os
    // turnos antigos em state.compactedHistory pra manter o prompt bounded.
    // Acima do threshold o custo é ~1 chamada Haiku extra por turno, bem
    // abaixo do que sai caro (bia_router + bia_answer com histórico infinito).
    .addEdge(START, "compact")
    .addEdge("compact", "router")
    .addConditionalEdges("router", routeFromRouter, {
      retrieve: "retrieve",
      answer: "answer",
      handoff: "handoff",
    })
    .addEdge("retrieve", "answer")
    .addEdge("answer", END)
    .addEdge("handoff", END);

  return graph.compile({ checkpointer: saver });
}

export async function getGraph() {
  if (!_compiled) _compiled = await build();
  return _compiled;
}

/** Roda o grafo para uma mensagem inbound. Retorna o reply e o estado final. */
export async function runSDR(args: {
  lead: Lead;
  userText: string;
}): Promise<{
  reply: string;
  needsHandoff: boolean;
  qualification: Qualification;
  handoffReason: HandoffReason | null;
  handoffUrgency: HandoffUrgency | null;
  score: number;
  stage: Stage | null;
  intent: Intent | null;
  sources: RetrievedSource[];
  mediaIntent: MediaIntent;
  mediaCategoria: FotoCategoria | null;
}> {
  const app = await getGraph();
  const threadId = `lead:${args.lead.id}`;
  const config = { configurable: { thread_id: threadId } };

  // Bug histórico (corrigido aqui): a cada turno reidratávamos as últimas 12
  // mensagens do banco como `HumanMessage(content)` SEM ID estável. O
  // `messagesStateReducer` do LangGraph anexa por id; sem id, gera um novo
  // a cada chamada → o checkpoint persistido acumulava 12 cópias adicionais
  // por turno, inflando o array `state.messages` indefinidamente. Em
  // conversas longas (60+ msgs) isso fazia o LLM ver a mesma pergunta
  // duplicada e responder duas vezes — exatamente o sintoma observado em
  // produção (msg "Essa parcela é durante a obra..." enviada 2x antes de
  // um handoff no lead da91854c, log de 2026-04-24 01:14).
  //
  // Solução: confia no checkpointer (PostgresSaver) pra continuidade
  // intra-thread. Reidratamos do banco APENAS quando o thread é novo
  // (cold start, deploy, ou primeira interação) e usamos IDs determinísticos
  // baseados em hash(role+content+timestamp) pra que re-runs sejam dedup
  // pelo reducer.
  const existing = await app.getState(config).catch(() => null);
  const hasState = Boolean(
    existing && Array.isArray(existing.values?.messages) && existing.values.messages.length > 0,
  );

  let initialMessages: Array<HumanMessage | AIMessage> = [];
  if (!hasState) {
    const history = await recentMessages(args.lead.id, 12);
    initialMessages = history.map((m) => {
      const id = stableMessageId(m.role, m.content, m.created_at);
      return m.role === "user"
        ? new HumanMessage({ content: m.content, id })
        : new AIMessage({ content: m.content, id });
    });
  }

  // O turno atual é a última mensagem do usuário. ID determinístico também
  // — protege contra retries do webhook que cheguem com mesma userText em
  // janela curta (raro, mas barato proteger).
  const turnUserMessage = new HumanMessage({
    content: args.userText,
    id: stableMessageId("user", args.userText, new Date().toISOString().slice(0, 16)),
  });

  const turnInput = {
    messages: [...initialMessages, turnUserMessage],
    leadId: args.lead.id,
    phone: args.lead.phone,
    pushName: args.lead.push_name,
    qualification: args.lead.qualification ?? {},
    agentNotes: args.lead.agent_notes ?? null,
    // Memória persistente — atualizada em background pelo webhook a cada N
    // mensagens. Pode estar vazia nos primeiros turnos (esperado).
    leadMemory: (args.lead.memory ?? "").trim(),
  } satisfies Partial<SDRStateType>;

  const final = await app.invoke(turnInput, config);

  return {
    reply: final.reply,
    needsHandoff: final.needsHandoff,
    qualification: final.qualification,
    handoffReason: final.handoffReason ?? null,
    handoffUrgency: final.handoffUrgency ?? null,
    score: final.score ?? 0,
    stage: final.stage ?? null,
    intent: final.intent ?? null,
    sources: final.retrievedSources ?? [],
    mediaIntent: final.mediaIntent ?? null,
    mediaCategoria: final.mediaCategoria ?? null,
  };
}
