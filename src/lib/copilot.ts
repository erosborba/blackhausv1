import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import { searchByQualification, searchSemantic } from "@/agent/retrieval";
import { leadIdFromRef } from "./handoff";
import type { Agent } from "./agents";
import { anthropicUsage, logUsage } from "./ai-usage";

/**
 * Bia no modo copiloto do corretor.
 *
 * Quando o corretor manda texto solto no WhatsApp (sem quote, sem /lead),
 * não encaminhamos nada ao cliente — respondemos como assistente dele.
 *
 * Tem acesso a tools (via Anthropic tool use) pra:
 *  - buscar empreendimentos (filtro estruturado ou semântico)
 *  - consultar qualquer lead por telefone
 * Assim ela pode responder com dados reais em vez de chutar.
 */

const COPILOT_SYSTEM = `Você é a Bia, assistente inteligente do corretor no sistema Blackhaus (vendas imobiliárias em Curitiba, PR).

# Quem você é
Você é uma SDR sênior virtual treinada pra operar em duas frentes distintas:
1. Conversando com leads via WhatsApp (qualificando, nutrindo, enviando materiais).
2. Neste modo — COPILOTO — ajudando o corretor humano a gerenciar a pipeline que você mesmo qualificou.

Neste chat você está no modo copiloto. Você NÃO está conversando com o lead. Você está conversando com o corretor (Eros, Rafael, etc), que é seu colega. Trate-o como um colega de trabalho experiente: direto, útil, sem floreio. pt-BR, tom informal profissional ("a gente tem", "rolou", "boa pedida", mas sem memes).

# Contexto da Blackhaus
• Mercado: alto padrão e médio-alto em Curitiba (bairros quentes: Batel, Água Verde, Juvevê, Cabral, Centro, Ecoville, Bigorrilho, São Francisco, Mossunguê).
• Perfil típico de lead: profissional liberal ou família classe A/B procurando lançamento ou estoque recente, ticket R$ 500k–R$ 3M.
• Objeções comuns: preço, ITBI/registro, prazo de entrega, metragem vs preço/m², condomínio alto, localização (barulho, fluxo, vizinhança).
• Diferenciais que costumam fechar: localização estratégica, pé-direito, vista, lazer completo, entrega prevista curta, tabela de pagamento flexível, permuta.

# Formatação (CRÍTICO — WhatsApp)
A resposta vai pro WhatsApp Web/Business, que NÃO renderiza Markdown completo.
• ❌ Tabelas Markdown (\`|---|\`) → viram lixo visual.
• ❌ \`###\` ou \`##\` pra títulos → aparece literal.
• ❌ \`**negrito duplo**\` → aparece literal.
• ✅ *negrito com asterisco único* (WhatsApp converte).
• ✅ _itálico com underscore único_.
• ✅ Listas com "• " ou "- " e quebras de linha.
• ✅ Emojis no começo de blocos pra ajudar a escanear: 🏢 📍 💰 🏗️ 🎯 🛏️ 🚗 📅 ✅ ⚠️ 👇.
• ✅ Prosa curta + bullets. Se for tabular, use 2 colunas separadas por " · " ou " → " na mesma linha.
• Resposta ideal: 4-12 linhas. Passou disso, você provavelmente está despejando em vez de filtrar.

# Tools — use-as SEMPRE que precisar de dado concreto
Você NUNCA inventa preço, endereço, metragem, diferencial, status ou qualificação de lead. Se a informação não tá no contexto, você chama a tool.

• **buscar_empreendimentos_filtro** — filtra ativos por cidade/bairros/preço máx. Use quando o corretor disse "o que tem no Batel", "opções até R$ 800k", "mostra em Curitiba".
• **buscar_empreendimentos_semantico** — busca aberta em linguagem natural. Use pra diferenciais específicos ("pet-friendly", "rooftop", "coworking"), estilo arquitetônico, público-alvo, detalhes técnicos (drywall, piso, acabamento). Se a busca filtrada trouxe pouco detalhe, escalada pra esta.
• **ver_lead** — puxa qualificação, brief e últimas mensagens de QUALQUER lead por telefone. Use quando o corretor pergunta sobre lead que NÃO está em foco ou você precisa confirmar dados antes de propor resposta.
• **propor_resposta** — você registra um draft pronto pro lead. O sistema entrega numa mensagem separada pro corretor copiar/aprovar limpo. Não escreva o texto do draft na sua resposta depois de chamar a tool; só comente brevemente (ex.: "Mandei um draft pro João separado aqui 👇").

# Quando usar propor_resposta
Use quando o corretor pedir explicitamente: "redige pra ele", "sugere resposta", "manda um texto", "responde o X", "bota um draft", "escreve pra mim".
NÃO use se ele só pediu orientação ("o que eu falo pra esse lead?") — aí você orienta, não redige.

Confiança do draft (self-report honesto):
• **alta** — tenho todos os dados: nome do lead, empreendimento de interesse, objeção/contexto específico, tom adequado. Draft pronto pra enviar sem edição.
• **media** — gist tá certo mas algum detalhe faltou (ex.: não sei qual tipologia exata, nome genérico). Corretor provavelmente vai ajustar 1-2 palavras.
• **baixa** — falta informação-chave. O draft é mais um esqueleto/placeholder do que resposta pronta. O corretor precisa editar bastante.

Seja severa com a autoavaliação. Confiança alta requer que você realmente tenha o contexto; se chutou qualquer coisa importante, é media ou baixa.

# Comportamento de continuidade
Você recebe histórico curto da conversa corretor↔você (últimos turnos). USE esse histórico:
• Se o corretor diz "mais detalhes", "e esse?", "manda pra ele", "edita isso" → está se referindo ao que você disse ANTES. Não peça "qual lead/empreendimento" se está óbvio do turno anterior.
• Se a referência é ambígua (ex.: 2 empreendimentos foram citados e o corretor diz "detalhes"), aí sim peça pra desambiguar.
• Se o histórico está vazio (primeira pergunta do corretor), não invente contexto — responde a pergunta atual de forma autônoma.

# Comandos diretos que o corretor pode usar (NÃO são tools, são atalhos do sistema)
Se o corretor pede algo que tem atalho, LEMBRE o atalho em vez de tentar resolver via tool:
• \`/status\` — lista leads atribuídos a ele.
• \`/lead <telefone> <mensagem>\` — envia mensagem direta pro lead sem precisar de quote.
• \`/fim\` — encerra a ponte do lead em foco.
• \`/help\` — lista todos os comandos.
Respondendo (quote) ao seu draft com 👍 → o sistema aprova e envia como está. Respondendo com texto editado → envia a versão dele.

# Anti-padrões (não faça)
❌ Repetir dados que acabou de receber numa tool sem filtrar o que importa.
❌ Propor ação ("quer que eu faça X?") mais de 1x por resposta.
❌ Usar emoji em CADA linha (fica infantil); use pra separar blocos, não pra decorar.
❌ Resposta longa quando o corretor fez pergunta curta.
❌ Mencionar "vou buscar no banco de dados" — só busca e entrega.
❌ Usar "eu" em excesso; prefira "a gente tem", "temos disponível", "rolou".`;

type ToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const TOOLS: ToolSchema[] = [
  {
    name: "buscar_empreendimentos_filtro",
    description:
      "Busca empreendimentos ativos filtrando por cidade, bairros e/ou preço máximo. Retorna texto com lista de empreendimentos (nome, localização, tipologias, preços, diferenciais).",
    input_schema: {
      type: "object",
      properties: {
        cidade: { type: "string", description: "Cidade (ex: Curitiba). Opcional." },
        bairros: {
          type: "array",
          items: { type: "string" },
          description: "Lista de bairros aceitos. Opcional.",
        },
        faixa_preco_max: {
          type: "number",
          description: "Preço máximo em reais (ex: 800000). Opcional.",
        },
      },
    },
  },
  {
    name: "buscar_empreendimentos_semantico",
    description:
      "Busca empreendimentos por similaridade semântica (RAG). Use pra perguntas abertas sobre diferenciais, lazer, público-alvo, estilo arquitetônico, características específicas.",
    input_schema: {
      type: "object",
      properties: {
        pergunta: {
          type: "string",
          description: "Pergunta ou descrição em linguagem natural (ex: 'empreendimentos com churrasqueira e pet-friendly no Batel').",
        },
      },
      required: ["pergunta"],
    },
  },
  {
    name: "ver_lead",
    description:
      "Busca contexto completo de um lead pelo telefone: qualificação (orçamento, quartos, etc), brief, últimas mensagens, status da ponte. Use quando o corretor perguntar sobre um lead específico que NÃO está em foco.",
    input_schema: {
      type: "object",
      properties: {
        telefone: {
          type: "string",
          description: "Telefone do lead em formato internacional (ex: 5541995298060).",
        },
      },
      required: ["telefone"],
    },
  },
  {
    name: "propor_resposta",
    description:
      "Registra um draft de mensagem pro lead. O sistema envia o draft numa mensagem separada pro corretor poder copiar/aprovar limpo no WhatsApp. NÃO reescreva o texto do draft no seu output depois de chamar essa tool — só comente brevemente (1 frase). O corretor aprova respondendo 👍 ao draft, ou envia uma versão editada.",
    input_schema: {
      type: "object",
      properties: {
        lead_telefone: {
          type: "string",
          description: "Telefone do lead pra quem o draft é destinado (ex: 5541995298060).",
        },
        texto: {
          type: "string",
          description: "Texto proposto, pronto pra enviar ao lead. Tom igual ao da Bia (pt-BR, informal profissional, sem markdown).",
        },
        confianca: {
          type: "string",
          enum: ["alta", "media", "baixa"],
          description: "Auto-avaliação de quanto você tem certeza do draft: alta (todos dados presentes), media (gist ok, falta detalhe), baixa (placeholder, precisa edição).",
        },
      },
      required: ["lead_telefone", "texto", "confianca"],
    },
  },
];

export type DraftProposal = {
  leadPhone: string;
  text: string;
  confidence: "alta" | "media" | "baixa";
};

/**
 * Tamanho máximo total de tool result (em chars). Acima disso truncamos,
 * com um aviso pra Bia saber que tem mais dados se quiser filtrar.
 *
 * Cada tool result viaja em TODAS as iterações subsequentes do loop de
 * tool use (o histórico cresce). Se o primeiro tool result é 5k chars e
 * a Bia faz 3 tool calls, você paga 5k × 3 = 15k input tokens extras.
 */
const TOOL_RESULT_MAX_CHARS = 2500;

// Uma vez por processo logamos o tamanho de tools+system pra confirmar se
// o cache tem massa suficiente (min 1024 tokens no Sonnet).
let turn0Debug = true;

function capToolResult(s: string): string {
  if (s.length <= TOOL_RESULT_MAX_CHARS) return s;
  return (
    s.slice(0, TOOL_RESULT_MAX_CHARS) +
    `\n\n[…truncado, mostre mais resultados só se o corretor pedir; peça pra ele estreitar o filtro em vez de solicitar tudo]`
  );
}

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === "buscar_empreendimentos_filtro") {
      const q = {
        cidade: typeof input.cidade === "string" ? input.cidade : undefined,
        bairros: Array.isArray(input.bairros) ? (input.bairros as string[]) : undefined,
        faixa_preco_max:
          typeof input.faixa_preco_max === "number" ? input.faixa_preco_max : undefined,
      } as Parameters<typeof searchByQualification>[0];
      const result = await searchByQualification(q, 5);
      return capToolResult(result || "(nenhum empreendimento bateu com os filtros)");
    }
    if (name === "buscar_empreendimentos_semantico") {
      const { text } = await searchSemantic(String(input.pergunta ?? ""), 4);
      return capToolResult(text || "(nenhum resultado)");
    }
    if (name === "ver_lead") {
      const phone = String(input.telefone ?? "");
      const id = await leadIdFromRef(phone);
      if (!id) return `Lead ${phone} não encontrado.`;
      const sb = supabaseAdmin();
      const [leadQ, msgsQ] = await Promise.all([
        sb
          .from("leads")
          .select(
            "phone, push_name, full_name, status, stage, qualification, brief, assigned_agent_id, bridge_active, bridge_closed_at",
          )
          .eq("id", id)
          .maybeSingle(),
        sb
          .from("messages")
          .select("direction, content, created_at")
          .eq("lead_id", id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      const l = leadQ.data as Record<string, unknown> | null;
      if (!l) return `Lead ${phone} não encontrado.`;
      const msgs = ((msgsQ.data ?? []) as Array<Record<string, unknown>>).reverse();
      const name = l.full_name || l.push_name || l.phone;
      const transcript =
        msgs
          .map(
            (m) =>
              `${m.direction === "inbound" ? "Lead" : "Bia"}: ${truncate(String(m.content ?? ""), 350)}`,
          )
          .join("\n") || "(sem mensagens)";
      const state = l.bridge_active
        ? "🟢 ponte ativa"
        : l.bridge_closed_at
          ? "💭 ponte encerrada"
          : "🟡 aguardando";
      const brief = l.brief ? truncate(String(l.brief), 900) : null;
      return capToolResult(
        [
          `${name} · ${l.phone} · ${state}`,
          `Status: ${l.status ?? "—"} · Estágio: ${l.stage ?? "—"}`,
          `Qualificação: ${JSON.stringify(l.qualification ?? {})}`,
          brief ? `Brief:\n${brief}` : null,
          `Últimas mensagens:\n${transcript}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return `Tool desconhecida: ${name}`;
  } catch (e) {
    console.error("[copilot] tool error", name, e);
    return `Erro ao executar ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Trunca string preservando prefixo legível. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export async function brokerCopilot(args: {
  agent: Agent;
  text: string;
}): Promise<{ reply: string; draft?: DraftProposal }> {
  const sb = supabaseAdmin();

  // Contexto 1: leads atribuídos ao corretor (top 5 recentes — antes eram 8
  // mas a gente raramente precisa mais que 5 pro corretor ter senso dos mais
  // urgentes, e cada linha extra custa tokens em todas as iterações do loop).
  const { data: myLeadsRaw } = await sb
    .from("leads")
    .select(
      "id, phone, push_name, full_name, status, stage, bridge_active, bridge_closed_at, handoff_notified_at",
    )
    .eq("assigned_agent_id", args.agent.id)
    .order("handoff_notified_at", { ascending: false })
    .limit(8);
  const myLeads = myLeadsRaw ?? [];

  const leadsList = myLeads.length
    ? myLeads
        .map((l: any) => {
          const name = l.full_name || l.push_name || l.phone;
          const state = l.bridge_active
            ? "🟢 ponte"
            : l.bridge_closed_at
              ? "💭 encerrada"
              : "🟡 aguardando";
          return `${state} ${name} · ${l.phone} (stage: ${l.stage ?? "—"})`;
        })
        .join("\n")
    : "(nenhum)";

  // Contexto 2: lead em foco (último que o corretor interagiu via quote/comando).
  // Limitamos bem agressivo pra não estourar rate limit no loop de tool use.
  let focusedBlock = "";
  if (args.agent.current_lead_id) {
    const [leadQ, msgsQ] = await Promise.all([
      sb
        .from("leads")
        .select("phone, push_name, full_name, status, stage, qualification, brief")
        .eq("id", args.agent.current_lead_id)
        .maybeSingle(),
      sb
        .from("messages")
        .select("direction, content, created_at")
        .eq("lead_id", args.agent.current_lead_id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (leadQ.data) {
      const lead: any = leadQ.data;
      const msgs = (msgsQ.data ?? []).reverse();
      const name = lead.full_name || lead.push_name || lead.phone;
      const qual = JSON.stringify(lead.qualification ?? {}, null, 0);
      const transcript = msgs
        .map(
          (m: any) =>
            `[${new Date(m.created_at).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" })}] ${m.direction === "inbound" ? "Lead" : "Bia"}: ${truncate(m.content ?? "", 400)}`,
        )
        .join("\n");
      const briefTrunc = lead.brief ? truncate(String(lead.brief), 1000) : "";
      focusedBlock = `

LEAD EM FOCO:
${name} · ${lead.phone}
Status: ${lead.status ?? "—"} · Estágio: ${lead.stage ?? "—"}
Qualificação: ${qual}
${briefTrunc ? `\nBrief:\n${briefTrunc}` : ""}

Últimas mensagens:
${transcript || "(sem mensagens)"}`;
    }
  }

  const dynamicContext = `LEADS ATRIBUÍDOS:
${leadsList}${focusedBlock}`;

  // Contexto 3: histórico curto de conversa corretor ↔ Bia (pra ela lembrar
  // do que tava falando quando o corretor manda "mais detalhes", "e esse?",
  // etc). Últimos 6 turnos = ~3 pares pergunta/resposta, suficiente pra
  // manter o fio sem inflar contexto.
  const { data: historyRaw } = await sb
    .from("copilot_turns")
    .select("role, content")
    .eq("agent_id", args.agent.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const history = ((historyRaw ?? []) as Array<{ role: "user" | "assistant"; content: string }>)
    .reverse();

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [
    ...history.map(
      (h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam,
    ),
    { role: "user", content: args.text },
  ];

  // Captura o último draft proposto (se a Bia chamar propor_resposta).
  let capturedDraft: DraftProposal | undefined;

  // Cache strategy: 2 breakpoints.
  //   1. Último tool (cacheia SÓ tools se >=1024 tokens)
  //   2. 1º bloco do system (cacheia tools+system_estático)
  // Se um breakpoint não bate o mínimo, ele é silenciosamente ignorado mas
  // não invalida os outros. Então mesmo que tools < 1024, o segundo
  // breakpoint ainda ativa o cache combinado de tools+system (~1500-1700).
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: COPILOT_SYSTEM,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: dynamicContext },
  ];

  // Clona TOOLS e anexa cache_control no último. Usamos `any` aqui porque o
  // tipo público `Anthropic.Tool` não expõe cache_control (mas a API aceita).
  const cachedTools = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  ) as unknown as Anthropic.Tool[];

  // Debug one-time: quantos chars os tools têm (aprox. chars/4 = tokens).
  if (turn0Debug) {
    turn0Debug = false;
    const toolsJson = JSON.stringify(TOOLS);
    console.log("[copilot] size probe", {
      toolsChars: toolsJson.length,
      toolsTokensEst: Math.round(toolsJson.length / 4),
      systemChars: COPILOT_SYSTEM.length,
      systemTokensEst: Math.round(COPILOT_SYSTEM.length / 4),
    });
  }

  // Loop de tool use. Cap em 4 iterações (era 5) — se não fechou em 4,
  // raramente vai fechar bem na 5ª e cada turno extra tem custo.
  const MAX_TURNS = 5;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let resp: Anthropic.Message;
    const turnT0 = Date.now();
    try {
      resp = await anthropic.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 800,
        system: systemBlocks,
        tools: cachedTools,
        messages,
      });
      const u = anthropicUsage(resp);
      logUsage({
        provider: "anthropic",
        model: env.ANTHROPIC_MODEL,
        task: "copilot",
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
        durationMs: Date.now() - turnT0,
        leadId: args.agent.current_lead_id ?? null,
        metadata: { turn, agent_id: args.agent.id, stop_reason: resp.stop_reason },
      });
    } catch (e) {
      // Rate limit é o caso mais comum de erro aqui — devolve mensagem
      // humana em vez de cascata de 429.
      const msg = e instanceof Error ? e.message : String(e);
      logUsage({
        provider: "anthropic",
        model: env.ANTHROPIC_MODEL,
        task: "copilot",
        durationMs: Date.now() - turnT0,
        leadId: args.agent.current_lead_id ?? null,
        ok: false,
        error: msg,
        metadata: { turn, agent_id: args.agent.id },
      });
      if (/rate[_ ]?limit|429/i.test(msg)) {
        console.warn("[copilot] rate limit hit, turn:", turn);
        return {
          reply:
            "Estourei o limite da IA aqui por 1 minuto (muitas perguntas em sequência). Tenta de novo em ~60s?",
          draft: capturedDraft,
        };
      }
      throw e;
    }

    if (resp.stop_reason !== "tool_use") {
      const final = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      const usage = resp.usage as typeof resp.usage & {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      console.log("[copilot] final reply", {
        turn,
        stopReason: resp.stop_reason,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        cacheCreate: usage?.cache_creation_input_tokens,
        cacheRead: usage?.cache_read_input_tokens,
        reply: final,
        hasDraft: Boolean(capturedDraft),
      });
      // Persiste o turno (pergunta + resposta) pra próxima chamada ter
      // contexto. Best-effort: erro de gravação não quebra a resposta.
      try {
        await sb.from("copilot_turns").insert([
          { agent_id: args.agent.id, role: "user", content: args.text },
          { agent_id: args.agent.id, role: "assistant", content: final || "(sem resposta)" },
        ]);
      } catch (e) {
        console.warn("[copilot] history save failed", e);
      }
      return { reply: final, draft: capturedDraft };
    }

    // Anexa a resposta do assistant (com os tool_use blocks) e processa as tools.
    messages.push({ role: "assistant", content: resp.content });

    // Captura qualquer texto intermediário que a Bia soltou junto com o tool_use.
    const interimText = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (interimText) {
      console.log("[copilot] interim text (turn " + turn + ")", interimText);
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        console.log("[copilot] tool_use", { name: block.name, input: block.input });

        // propor_resposta é meta-tool: capturamos o draft e devolvemos ack.
        if (block.name === "propor_resposta") {
          const input = block.input as {
            lead_telefone?: string;
            texto?: string;
            confianca?: DraftProposal["confidence"];
          };
          if (input.lead_telefone && input.texto && input.confianca) {
            capturedDraft = {
              leadPhone: String(input.lead_telefone).replace(/\D/g, ""),
              text: String(input.texto),
              confidence: input.confianca,
            };
            console.log("[copilot] draft captured", capturedDraft);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content:
                "Draft registrado. O sistema vai enviar o texto proposto numa mensagem separada pro corretor copiar/aprovar. Agora encerre com uma frase curta comentando o que você propôs (NÃO repita o texto do draft).",
            });
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: "Erro: faltam campos obrigatórios (lead_telefone, texto, confianca).",
              is_error: true,
            });
          }
          continue;
        }

        const output = await runTool(block.name, block.input as Record<string, unknown>);
        console.log("[copilot] tool_result", {
          name: block.name,
          outputPreview: output.slice(0, 400),
          outputLength: output.length,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  console.warn("[copilot] hit MAX_TURNS without final answer");
  return {
    reply: "Perdi a linha de raciocínio aqui — pode reformular a pergunta?",
    draft: capturedDraft,
  };
}
