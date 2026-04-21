import { StateGraph, END, START } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { SDRState, type SDRStateType, type HandoffReason, type HandoffUrgency } from "./state";
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
}> {
  const app = await getGraph();
  const threadId = `lead:${args.lead.id}`;

  // Reidrata as últimas mensagens persistidas como contexto inicial
  // (o checkpointer manterá o estado entre turnos via thread_id).
  const history = await recentMessages(args.lead.id, 12);
  const initialMessages = history.map((m) =>
    m.role === "user"
      ? new HumanMessage(m.content)
      : new HumanMessage({ content: m.content, name: "assistant" }),
  );
  // O turno atual é a última mensagem do usuário:
  const turnInput = {
    messages: [...initialMessages, new HumanMessage(args.userText)],
    leadId: args.lead.id,
    phone: args.lead.phone,
    pushName: args.lead.push_name,
    qualification: args.lead.qualification ?? {},
    agentNotes: args.lead.agent_notes ?? null,
    // Memória persistente — atualizada em background pelo webhook a cada N
    // mensagens. Pode estar vazia nos primeiros turnos (esperado).
    leadMemory: (args.lead.memory ?? "").trim(),
  } satisfies Partial<SDRStateType>;

  const final = await app.invoke(turnInput, {
    configurable: { thread_id: threadId },
  });

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
  };
}
