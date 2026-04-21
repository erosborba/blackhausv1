import Anthropic from "@anthropic-ai/sdk";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { chatModel } from "@/lib/anthropic";
import { ROUTER_SYSTEM, SYSTEM_SDR, recommendSystem } from "./prompts";
import { searchByQualification, searchSemantic } from "./retrieval";
import type { SDRStateType, Intent, Stage, HandoffReason, HandoffUrgency } from "./state";
import type { Qualification } from "@/lib/leads";
import { env } from "@/lib/env";
import { anthropicUsage, langchainAnthropicUsage, logUsage } from "@/lib/ai-usage";
import { getRecentDraftEdits } from "@/lib/draft-learnings";
import { getSettingNumber } from "@/lib/settings";
import { checkFactualClaims } from "./factcheck";
import { computeLeadScore } from "@/lib/lead-score";

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
const RAG_STRONG_THRESHOLD_DEFAULT = 0.55;

/**
 * Compactação de histórico (Tier 2 #4).
 *
 * Quando o array `messages` do state passa de N, pegamos os mais antigos
 * (tudo exceto os últimos K) e pedimos pra um Haiku resumir em 2-4 frases.
 * O resumo vai pra `state.compactedHistory` e os nodes LLM downstream
 * passam a usar só:
 *   - SYSTEM + compactedHistory (resumo dos turnos antigos)
 *   - últimos K messages verbatim
 *
 * Ganho: prompt bounded mesmo em leads que conversaram 50+ turnos, sem
 * perder o fio da meada.
 *
 * Trade-off conhecido: o checkpointer guarda todo o array original no banco
 * (tech debt — o `messagesStateReducer` anexa por ID e nossos HumanMessages
 * recebem ID auto-gerado a cada invocação, então re-hidratação vira
 * duplicação). A compactação aqui só corta o que o LLM vê, não o que
 * persiste. TODO: migrar pra RemoveMessage quando for apertar.
 */
const COMPACT_THRESHOLD_DEFAULT = 20;
const COMPACT_KEEP_TAIL = 8;
const COMPACT_MODEL = "claude-haiku-4-5";

/**
 * Devolve os últimos K messages (tail) — o resto foi compactado em
 * `state.compactedHistory`. Usado tanto pelo routerNode quanto pelo answer.
 */
function recentTail(state: SDRStateType, keep = COMPACT_KEEP_TAIL): BaseMessage[] {
  if (state.messages.length <= keep) return state.messages;
  return state.messages.slice(-keep);
}

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

/** Serializa messages velhos pra mandar pro Haiku resumir. */
function serializeForCompaction(msgs: BaseMessage[]): string {
  return msgs
    .map((m) => {
      const role = m.getType() === "human" ? "Lead" : "Bia";
      return `${role}: ${String(m.content).trim()}`;
    })
    .filter(Boolean)
    .join("\n");
}

const COMPACT_SYSTEM = `Você condensa um trecho de conversa WhatsApp entre uma SDR imobiliária (Bia) e um lead em 2-4 frases densas.

Objetivo: preservar info acionável (o que o lead pediu, objeções que levantou, empreendimentos discutidos, compromissos assumidos) e descartar social talk. Escreva em terceira pessoa, pt-BR, sem markdown, sem bullet.

Responda SOMENTE com o resumo, sem prefixo.`;

/**
 * Nó de compactação. Roda ANTES do router. Se messages < threshold, passa
 * direto sem custo. Acima, chama Haiku (barato, rápido) pra resumir tudo
 * exceto os últimos COMPACT_KEEP_TAIL turnos.
 *
 * Escreve em `state.compactedHistory` — messages original segue intocado.
 * Router/answer usam `recentTail()` pra só ver os últimos K ao montar o
 * prompt, e injetam `compactedHistory` no system.
 */
export async function compactNode(state: SDRStateType) {
  const threshold = await getSettingNumber(
    "compact_threshold",
    COMPACT_THRESHOLD_DEFAULT,
  );
  if (state.messages.length <= threshold) return {};

  // Já foi compactado neste turno? Não recompactar (o número de messages
  // pode aumentar no mesmo turno depois do answer, mas compactNode só
  // roda no início).
  //
  // Se já tem compactedHistory do turno anterior, a gente INCREMENTA:
  // pega o resumo antigo + os novos turnos (exceto os últimos K) e pede
  // pro Haiku re-sumir. Isso mantém a história "rolando" sem inflar.
  const toCompact = state.messages.slice(0, state.messages.length - COMPACT_KEEP_TAIL);
  const transcript = serializeForCompaction(toCompact);
  if (!transcript) return {};

  const priorBlock = state.compactedHistory
    ? `Resumo anterior (incorpore):\n${state.compactedHistory}\n\n`
    : "";

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  try {
    const resp = await anthropic.messages.create({
      model: COMPACT_MODEL,
      max_tokens: 400,
      system: COMPACT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${priorBlock}Trecho pra resumir:\n${transcript}`,
        },
      ],
    });
    const summary = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    logUsage({
      provider: "anthropic",
      model: COMPACT_MODEL,
      task: "context_compact",
      ...anthropicUsage(resp),
      durationMs: Date.now() - t0,
      leadId: state.leadId || null,
      ok: true,
      metadata: {
        messages_compacted: toCompact.length,
        tail_kept: COMPACT_KEEP_TAIL,
      },
    });
    if (!summary) return {};
    return { compactedHistory: summary };
  } catch (e) {
    // Falha de compactação é fire-and-forget: seguimos com o histórico
    // bruto. Custo ruim, mas não quebra a UX.
    logUsage({
      provider: "anthropic",
      model: COMPACT_MODEL,
      task: "context_compact",
      durationMs: Date.now() - t0,
      leadId: state.leadId || null,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
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

  // Compactação de turnos antigos desta sessão (Tier 2 #4). Se houver,
  // entra como contexto adicional no prompt — assim o roteamento não
  // "esquece" decisões tomadas 20 turnos atrás só porque cortamos o tail.
  const compactBlock = state.compactedHistory
    ? `Resumo dos turnos anteriores desta sessão (compactado):
${state.compactedHistory}

`
    : "";

  const prompt = `${memoryBlock}${compactBlock}Histórico:
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
    handoff_reason?: HandoffReason | null;
    handoff_urgency?: HandoffUrgency | null;
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

  // Handoff estruturado: só aceita reason/urgency quando intent realmente é
  // handoff_humano (evita lixo quando o modelo esquece de zerar os campos).
  // Defaults se o router omitir: reason="lead_pediu_humano" + urgency="media".
  const isHandoff = parsed.intent === "handoff_humano";
  const validReasons: HandoffReason[] = [
    "lead_pediu_humano",
    "fora_de_escopo",
    "objecao_complexa",
    "ia_incerta",
    "urgencia_alta",
    "escalacao",
    "outro",
  ];
  const validUrgencies: HandoffUrgency[] = ["baixa", "media", "alta"];
  const handoffReason: HandoffReason | null = isHandoff
    ? validReasons.includes(parsed.handoff_reason as HandoffReason)
      ? (parsed.handoff_reason as HandoffReason)
      : "lead_pediu_humano"
    : null;
  const handoffUrgency: HandoffUrgency | null = isHandoff
    ? validUrgencies.includes(parsed.handoff_urgency as HandoffUrgency)
      ? (parsed.handoff_urgency as HandoffUrgency)
      : "media"
    : null;

  // Score 0-100 calculado aqui — serve pro Priority Rail do inbox. Custo:
  // puro CPU, ~0ms, explicável (ver `computeLeadScore`). Persistido em
  // `leads.score` pelo webhook (runAgentTurn).
  const { total: score } = computeLeadScore({
    qualification: newQual,
    stage: parsed.next_stage,
    intent: parsed.intent,
    messageCount: state.messages.length,
    handoffUrgency,
  });

  return {
    intent: parsed.intent,
    stage: parsed.next_stage,
    qualification: parsed.extracted ?? {},
    missingFields:
      parsed.missing_fields && parsed.missing_fields.length > 0
        ? parsed.missing_fields
        : missingFromQualification(newQual),
    needsHandoff: isHandoff,
    handoffReason,
    handoffUrgency,
    score,
  };
}

/** Recupera contexto de empreendimentos relevante. */
export async function retrieveNode(state: SDRStateType) {
  const last = state.messages.at(-1);
  const userText = last ? String(last.content) : "";

  let context = "";
  let confidence: "strong" | "weak" | "none" = "none";
  let sources: import("./retrieval").RetrievedSource[] = [];

  if (state.intent === "duvida_empreendimento" && userText) {
    const ragThreshold = await getSettingNumber("rag_strong_threshold", RAG_STRONG_THRESHOLD_DEFAULT);
    const r = await searchSemantic(userText, 5);
    context = r.text;
    sources = r.items;
    if (!context) {
      confidence = "none";
    } else if (r.topScore === null) {
      // Fallback bruto (catálogo sem score) — tratamos como fraco pra
      // forçar a Bia a ser conservadora em dúvidas específicas.
      confidence = "weak";
    } else {
      confidence = r.topScore >= ragThreshold ? "strong" : "weak";
    }
  } else if (state.intent === "qualificar" || state.intent === "agendar" || state.intent === "saudacao") {
    const r = await searchByQualification(state.qualification, 5);
    context = r.text;
    sources = r.items;
    // Busca estruturada: se achou algo, é "strong" (casou critérios duros).
    confidence = context ? "strong" : "none";
  }

  return { retrieved: context, retrievedConfidence: confidence, retrievedSources: sources };
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

  // Resumo de turnos antigos desta sessão (compactação). Cross-session é
  // `memoryBlock`; este é apenas intra-session. Opcional.
  const compactBlock =
    state.compactedHistory && state.compactedHistory.trim().length > 0
      ? `RESUMO DOS TURNOS ANTERIORES DESTA SESSÃO (compactado para caber no contexto — os turnos literais abaixo são só os mais recentes):
${state.compactedHistory.trim()}`
      : null;

  // Prompt caching strategy (Anthropic ephemeral cache, 5min TTL, ~90% desconto):
  //
  //   Bloco 1 (cache, global): SYSTEM_SDR + learningsBlock
  //     → estável entre todos os leads; invalida só quando corretor edita drafts
  //       (learnings muda). Bate o min 1024 tokens do Sonnet quando há learnings.
  //   Bloco 2 (cache, por-lead): memoryBlock
  //     → estável dentro da janela de 5min do mesmo lead; invalida quando a
  //       memory_updater regrava a memória (~a cada 8 msgs).
  //   Bloco 3 (não cacheado): ragBlock + notesBlock + routing context
  //     → muda a cada turno.
  //
  // Anthropic aceita até 4 breakpoints — usamos 2. Se algum bloco ficar abaixo
  // do mínimo do modelo, o breakpoint é silenciosamente ignorado (não quebra).
  const stableText = [SYSTEM_SDR, learningsBlock || null]
    .filter(Boolean)
    .join("\n\n---\n\n");
  // Bloco per-lead: memória cross-session + resumo intra-session. Os dois
  // mudam em janelas relativamente longas (memória a cada ~8 msgs, compact
  // a cada ~20 msgs), então cabe um breakpoint de cache aqui.
  const perLeadText = [memoryBlock, compactBlock]
    .filter(Boolean)
    .join("\n\n---\n\n");
  const volatileText = [
    ragBlock,
    notesBlock,
    `Contexto interno do roteamento (NÃO mencionar ao lead):
- intent: ${state.intent}
- stage: ${state.stage}
- qualification: ${JSON.stringify(state.qualification)}
- rag_confidence: ${state.retrievedConfidence}
- ação sugerida: ${stageHint}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  // Content blocks com cache_control. Tipagem do @langchain/core não expõe
  // cache_control no content block — castamos pra unknown e deixamos o
  // @langchain/anthropic passar pro SDK da Anthropic, que aceita.
  const systemContent: Array<Record<string, unknown>> = [
    { type: "text", text: stableText, cache_control: { type: "ephemeral" } },
  ];
  if (perLeadText) {
    systemContent.push({
      type: "text",
      text: perLeadText,
      cache_control: { type: "ephemeral" },
    });
  }
  if (volatileText) {
    systemContent.push({ type: "text", text: volatileText });
  }

  // Só os últimos K turnos vão verbatim pro LLM. Tudo antes disso foi
  // compactado em `perLeadText` via compactNode (se atingiu threshold).
  const messages = [
    new SystemMessage({ content: systemContent as never }),
    ...recentTail(state),
  ];

  const t0 = Date.now();
  const out = await llm.invoke(messages);
  let reply = String(out.content).trim();

  // Backstop anti-alucinação: se a resposta cita preço/ano/metragem e
  // esses números não aparecem no retrieved, substitui por fallback seguro.
  //
  // Política (conservadora, só bloqueia casos óbvios):
  //  - retrievedConfidence=strong + reply com claim fora do contexto →
  //    SUBSTITUI. A promessa do modo strong é "responde pelo contexto";
  //    se saiu algo que não está lá, é alucinação direta.
  //  - retrievedConfidence=weak/none + reply com claim numérico →
  //    SUBSTITUI também. A Bia não deveria citar número sem contexto.
  //  - Em ambos os casos logamos `suspicious_claims` no ai_usage_log
  //    pra calibrar o post-check sem cegar com falsos positivos.
  //
  // Fallback: mensagem genérica de "vou confirmar com o consultor". Já é o
  // padrão que a Bia usa em confidence=weak, então UX é coerente.
  const factCheck = checkFactualClaims(reply, state.retrieved ?? "");
  let blocked = false;
  // Quando o factcheck bloqueia, promovemos pra handoff "ia_incerta" (baixa
  // urgência). A mensagem acima já prometeu que o consultor volta — agora
  // garantimos que ele seja notificado de verdade.
  let escalateHandoff = false;
  if (!factCheck.ok) {
    blocked = true;
    reply =
      "Vou confirmar esse dado com o consultor e já te volto com a informação certa 🙏";
    escalateHandoff = true;
  }

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
        // Observabilidade do post-check: lista de claims e quais falharam.
        // `factcheck_blocked=true` significa que a resposta foi reescrita.
        factcheck_claims: factCheck.claims.length,
        factcheck_suspicious: factCheck.suspicious.map((c) => ({
          kind: c.kind,
          raw: c.raw,
        })),
        factcheck_blocked: blocked,
      },
    });
  }
  // Se o router já tinha intent=handoff_humano, respeita os reason/urgency
  // dele. Se estamos escalando por factcheck, sobrepõe com ia_incerta/baixa
  // (a gente não quer perturbar corretor com urgência alta por incerteza).
  const finalNeedsHandoff = state.intent === "handoff_humano" || escalateHandoff;
  const finalReason =
    state.intent === "handoff_humano"
      ? state.handoffReason
      : escalateHandoff
        ? ("ia_incerta" as const)
        : null;
  const finalUrgency =
    state.intent === "handoff_humano"
      ? state.handoffUrgency
      : escalateHandoff
        ? ("baixa" as const)
        : null;

  return {
    reply,
    messages: [new AIMessage(reply)],
    needsHandoff: finalNeedsHandoff,
    handoffReason: finalReason,
    handoffUrgency: finalUrgency,
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
