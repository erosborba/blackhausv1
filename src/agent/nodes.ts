import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatModel } from "@/lib/anthropic";
import { ROUTER_SYSTEM, SYSTEM_SDR, recommendSystem } from "./prompts";
import { searchByQualification, searchSemantic } from "./retrieval";
import type { SDRStateType, Intent, Stage } from "./state";
import type { Qualification } from "@/lib/leads";
import { env } from "@/lib/env";
import { langchainAnthropicUsage, logUsage } from "@/lib/ai-usage";
import { getRecentDraftEdits } from "@/lib/draft-learnings";

/**
 * Threshold de confiança do retrieval semântico.
 *
 * Cosine similarity (0..1): acima de ~0.55 consideramos que o chunk
 * realmente cobre a pergunta. Abaixo disso, o texto veio do pgvector
 * mas é provavelmente ruído — melhor a Bia admitir que não sabe do que
 * alucinar com contexto fraco.
 *
 * Se ajustar, mexer aqui e observar o log de bia_answer:
 *   has_retrieved=true + retrievedConfidence="weak" = candidate a revisar.
 */
const RAG_STRONG_THRESHOLD = 0.55;

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

  const memoryBlock = state.leadMemory
    ? `Memória persistente do lead (contexto acumulado de sessões anteriores — use pra entender intent com mais precisão, NÃO cite literalmente):
${state.leadMemory}

`
    : "";

  const prompt = `${memoryBlock}Histórico:
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
  let confidence: "strong" | "weak" | "none" = "none";

  if (state.intent === "duvida_empreendimento" && userText) {
    const r = await searchSemantic(userText, 5);
    context = r.text;
    if (!context) {
      confidence = "none";
    } else if (r.topScore === null) {
      // Fallback bruto (catálogo sem score) — tratamos como fraco pra
      // forçar a Bia a ser conservadora em dúvidas específicas.
      confidence = "weak";
    } else {
      confidence = r.topScore >= RAG_STRONG_THRESHOLD ? "strong" : "weak";
    }
  } else if (state.intent === "qualificar" || state.intent === "agendar" || state.intent === "saudacao") {
    context = await searchByQualification(state.qualification, 5);
    // Busca estruturada: se achou algo, é "strong" (casou critérios duros).
    confidence = context ? "strong" : "none";
  }

  return { retrieved: context, retrievedConfidence: confidence };
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
        if (state.retrievedConfidence === "strong") {
          return "Responda a dúvida usando SOMENTE o contexto recuperado. Seja específica e cite o empreendimento pelo nome.";
        }
        // Weak ou none: não alucinar. Admita que não tem a info e passa pro consultor.
        return "Você NÃO tem contexto confiável pra responder essa dúvida específica. NÃO invente dados. Diga em 1-2 frases que vai confirmar a informação com o consultor e volta logo em seguida.";
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

  // Memória persistente: resumo de turnos passados, atualizada em background.
  // Serve pra: (1) não repetir perguntas já respondidas, (2) respeitar
  // restrições soft já expressas, (3) manter tom coerente entre sessões.
  const memoryBlock =
    state.leadMemory && state.leadMemory.trim().length > 0
      ? `MEMÓRIA DO LEAD (contexto acumulado de sessões passadas — use como background, NÃO cite literalmente ao lead):
${state.leadMemory.trim()}`
      : null;

  // Few-shot de correções recentes dos corretores (feedback loop).
  // Buscado em paralelo com o resto — se der erro, apenas segue sem exemplos.
  const learningsBlock = await getRecentDraftEdits().catch(() => "");

  // Só injeta o bloco de RAG quando a confiança é forte. Weak/none:
  // escondemos o contexto pra não tentar o modelo a improvisar com ele.
  const ragBlock =
    state.retrieved && state.retrievedConfidence === "strong"
      ? recommendSystem(state.retrieved)
      : null;

  const systemParts = [
    SYSTEM_SDR,
    memoryBlock,
    learningsBlock || null,
    ragBlock,
    notesBlock,
    `Contexto interno do roteamento (NÃO mencionar ao lead):
- intent: ${state.intent}
- stage: ${state.stage}
- qualification: ${JSON.stringify(state.qualification)}
- rag_confidence: ${state.retrievedConfidence}
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
      metadata: {
        intent: state.intent,
        stage: state.stage,
        has_retrieved: Boolean(state.retrieved),
        rag_confidence: state.retrievedConfidence,
        has_learnings: Boolean(learningsBlock),
      },
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
