import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatModel } from "@/lib/anthropic";
import { ROUTER_SYSTEM, SYSTEM_SDR, recommendSystem } from "./prompts";
import { searchByQualification, searchSemantic } from "./retrieval";
import type { SDRStateType, Intent, Stage } from "./state";
import type { Qualification } from "@/lib/leads";
import { env } from "@/lib/env";
import { langchainAnthropicUsage, logUsage } from "@/lib/ai-usage";

const REQUIRED_FIELDS: (keyof Qualification)[] = [
  "tipo",
  "quartos",
  "cidade",
  "faixa_preco_max",
  "prazo",
];

function missingFromQualification(q: Qualification): string[] {
  return REQUIRED_FIELDS.filter((k) => q[k] === undefined || q[k] === null).map(String);
}

function summarizeHistory(state: SDRStateType, take = 8): string {
  return state.messages
    .slice(-take)
    .map((m) => {
      const role = m.getType() === "human" ? "Lead" : "Bia";
      return `${role}: ${m.content}`;
    })
    .join("\n");
}

/** Classifica intent + estágio, e atualiza qualificação detectada na última msg. */
export async function routerNode(state: SDRStateType) {
  const llm = chatModel(0).bindTools?.([]) ?? chatModel(0);
  const last = state.messages.at(-1);
  if (!last) return { intent: "saudacao" as Intent, stage: "greet" as Stage };

  const prompt = `Histórico:
${summarizeHistory(state, 6)}

Última mensagem do lead:
"${last.content}"

Estado atual da qualificação:
${JSON.stringify(state.qualification)}

Extraia também QUALQUER campo da qualificação que apareça na última mensagem
(tipo, quartos, cidade, bairros, faixa_preco_min, faixa_preco_max, finalidade, prazo, pagamento, usa_fgts, usa_mcmv).
Anexe um campo "extracted" no JSON com SOMENTE os campos detectados.`;

  const t0 = Date.now();
  const out = await llm.invoke([new SystemMessage(ROUTER_SYSTEM), new HumanMessage(prompt)]);
  const raw = String(out.content).trim();
  {
    const u = langchainAnthropicUsage(out);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "bia_router",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      durationMs: Date.now() - t0,
      leadId: state.leadId || null,
    });
  }

  // Tolerante a fences ```json
  const jsonText = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  let parsed: {
    intent: Intent;
    next_stage: Stage;
    missing_fields?: string[];
    extracted?: Qualification;
    rationale?: string;
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {
      intent: "qualificar",
      next_stage: "qualify",
      missing_fields: missingFromQualification(state.qualification),
    };
  }

  const newQual = { ...state.qualification, ...(parsed.extracted ?? {}) };
  return {
    intent: parsed.intent,
    stage: parsed.next_stage,
    qualification: parsed.extracted ?? {},
    missingFields:
      parsed.missing_fields && parsed.missing_fields.length > 0
        ? parsed.missing_fields
        : missingFromQualification(newQual),
    needsHandoff: parsed.intent === "handoff_humano",
  };
}

/** Recupera contexto de empreendimentos relevante. */
export async function retrieveNode(state: SDRStateType) {
  const last = state.messages.at(-1);
  const userText = last ? String(last.content) : "";

  let context = "";
  if (state.intent === "duvida_empreendimento" && userText) {
    context = await searchSemantic(userText, 5);
  } else if (state.intent === "qualificar" || state.intent === "agendar" || state.intent === "saudacao") {
    context = await searchByQualification(state.qualification, 5);
  }
  return { retrieved: context };
}

/** Gera a resposta final em texto natural de WhatsApp. */
export async function answerNode(state: SDRStateType) {
  const llm = chatModel(0.5);

  const stageHint = (() => {
    switch (state.intent) {
      case "saudacao":
        return "É a primeira interação ou cumprimento. Apresente-se em uma frase, pergunte como pode ajudar (sem listar perguntas).";
      case "qualificar":
        return `Faça UMA pergunta para descobrir o próximo campo faltante. Faltando: ${state.missingFields.join(", ") || "nada"}.`;
      case "duvida_empreendimento":
        return "Responda a dúvida usando SOMENTE o contexto recuperado. Se não tiver no contexto, diga que vai confirmar com o consultor.";
      case "agendar":
        return "Confirme o interesse, peça melhor dia/horário (manhã/tarde/noite) e diga que vai passar para o consultor agendar.";
      case "fora_de_escopo":
        return "Explique gentilmente o escopo (apenas empreendimentos novos das cidades atendidas) e redirecione.";
      case "handoff_humano":
        return "Avise que vai chamar um consultor humano agora. Seja breve.";
      default:
        return "Continue a conversa de forma natural.";
    }
  })();

  // Claude 4 exige UM único SystemMessage no início. Concatenamos as partes.
  const notesBlock =
    state.agentNotes && state.agentNotes.trim().length > 0
      ? `DICAS DO CONSULTOR HUMANO (confidenciais, NÃO mencionar ao lead — use para orientar sua resposta):
${state.agentNotes.trim()}`
      : null;

  const systemParts = [
    SYSTEM_SDR,
    state.retrieved ? recommendSystem(state.retrieved) : null,
    notesBlock,
    `Contexto interno do roteamento (NÃO mencionar ao lead):
- intent: ${state.intent}
- stage: ${state.stage}
- qualification: ${JSON.stringify(state.qualification)}
- ação sugerida: ${stageHint}`,
  ].filter(Boolean).join("\n\n---\n\n");

  const messages = [new SystemMessage(systemParts), ...state.messages];

  const t0 = Date.now();
  const out = await llm.invoke(messages);
  const reply = String(out.content).trim();
  {
    const u = langchainAnthropicUsage(out);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "bia_answer",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      durationMs: Date.now() - t0,
      leadId: state.leadId || null,
      metadata: { intent: state.intent, stage: state.stage, has_retrieved: Boolean(state.retrieved) },
    });
  }
  return {
    reply,
    messages: [new AIMessage(reply)],
    needsHandoff: state.intent === "handoff_humano",
  };
}

/** Marca handoff (a entrega da mensagem é feita fora do grafo). */
export async function handoffNode(state: SDRStateType) {
  const text =
    state.reply ||
    "Vou chamar um dos nossos consultores aqui pra te atender. Só um instante 🙏";
  return {
    reply: text,
    messages: [new AIMessage(text)],
    needsHandoff: true,
  };
}

export function routeFromRouter(state: SDRStateType): "retrieve" | "answer" | "handoff" {
  if (state.intent === "handoff_humano") return "handoff";
  if (state.intent === "duvida_empreendimento" || state.intent === "qualificar" || state.intent === "agendar") {
    return "retrieve";
  }
  return "answer";
}
