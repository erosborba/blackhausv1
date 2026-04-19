import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import { searchByQualification, searchSemantic } from "@/agent/retrieval";
import { leadIdFromRef } from "./handoff";
import type { Agent } from "./agents";

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

const COPILOT_SYSTEM = `Você é a Bia, assistente inteligente do corretor no sistema Blackhaus (vendas imobiliárias em Curitiba).

Modo atual: **copiloto do corretor** (não está conversando com o lead).
• Ajude o corretor a gerenciar os leads que a Bia qualificou.
• Responda dúvidas, sugira abordagens, lembre contexto, proponha próximas ações.
• Seja concisa e acionável. pt-BR, tom informal profissional.

FORMATAÇÃO: a resposta vai pro WhatsApp, que NÃO renderiza Markdown.
• Não use tabelas Markdown (\`|---|\`) — viram lixo visual.
• Não use \`###\` ou \`##\` pra títulos — vira literal.
• Pode usar *negrito* (asterisco único do WhatsApp) e _itálico_ (underscore único) com parcimônia.
• Use listas com "• " ou "- " e quebras de linha. Emojis são ok pra separar blocos.
• Prefira prosa curta + bullets. Tabela = 2 colunas texto separado por " · " ou "→".

Você tem TOOLS. Use-as sempre que precisar de informação concreta — nunca invente preços, endereços, diferenciais ou dados de lead.
  • buscar_empreendimentos_filtro — filtra por cidade/bairros/preço máx. Use quando tiver critério claro.
  • buscar_empreendimentos_semantico — busca aberta em linguagem natural (diferenciais, estilo, lazer, etc).
  • ver_lead — puxa qualificação + brief + últimas mensagens de QUALQUER lead por telefone (útil quando o corretor pergunta sobre lead que não está em foco).
  • propor_resposta — use quando o corretor pedir pra você redigir/sugerir uma mensagem pro cliente. Você registra o draft e o sistema entrega numa mensagem separada pro corretor (pra ele copiar limpinho ou aprovar). NÃO inclua o texto do draft no seu texto de resposta depois de chamar essa tool — só comente brevemente o que você mandou (ex.: "Mandei um draft pro João separado aqui embaixo 👇").

Quando usar propor_resposta:
  • Corretor pediu "redige pra ele", "sugere resposta", "manda um texto", "responde X".
  • Você vai propor uma mensagem pronta (não só orientar).
  • Confiança: "alta" = tenho todos os dados necessários; "media" = faltam detalhes mas o gist tá certo; "baixa" = falta informação-chave, está mais como placeholder.

Se o corretor pedir algo tipo "manda pro lead X" sem você ter redigido draft antes, LEMBRE:
  • Pra enviar no automático ele usa: /lead <telefone> <mensagem>
  • Ou respondendo (quote) o draft que você acabou de propor com 👍 (aprova como está) ou com a versão editada.

Comandos que o corretor pode usar:
  /status — lista leads atribuídos
  /lead <telefone> <mensagem> — envia ao lead sem precisar de quote
  /fim — encerra ponte do lead em foco
  /help — lista comandos`;

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

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === "buscar_empreendimentos_filtro") {
      const q = {
        cidade: typeof input.cidade === "string" ? input.cidade : undefined,
        bairros: Array.isArray(input.bairros) ? (input.bairros as string[]) : undefined,
        faixa_preco_max:
          typeof input.faixa_preco_max === "number" ? input.faixa_preco_max : undefined,
      } as Parameters<typeof searchByQualification>[0];
      const result = await searchByQualification(q, 8);
      return result || "(nenhum empreendimento bateu com os filtros)";
    }
    if (name === "buscar_empreendimentos_semantico") {
      const result = await searchSemantic(String(input.pergunta ?? ""), 6);
      return result || "(nenhum resultado)";
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
          .map((m) => `${m.direction === "inbound" ? "Lead" : "Bia"}: ${m.content}`)
          .join("\n") || "(sem mensagens)";
      const state = l.bridge_active
        ? "🟢 ponte ativa"
        : l.bridge_closed_at
          ? "💭 ponte encerrada"
          : "🟡 aguardando";
      return [
        `${name} · ${l.phone} · ${state}`,
        `Status: ${l.status ?? "—"} · Estágio: ${l.stage ?? "—"}`,
        `Qualificação: ${JSON.stringify(l.qualification ?? {})}`,
        l.brief ? `Brief:\n${l.brief}` : null,
        `Últimas mensagens:\n${transcript}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    return `Tool desconhecida: ${name}`;
  } catch (e) {
    console.error("[copilot] tool error", name, e);
    return `Erro ao executar ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function brokerCopilot(args: {
  agent: Agent;
  text: string;
}): Promise<{ reply: string; draft?: DraftProposal }> {
  const sb = supabaseAdmin();

  // Contexto 1: leads atribuídos ao corretor (top 8 recentes).
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
        .limit(12),
    ]);
    if (leadQ.data) {
      const lead: any = leadQ.data;
      const msgs = (msgsQ.data ?? []).reverse();
      const name = lead.full_name || lead.push_name || lead.phone;
      const qual = JSON.stringify(lead.qualification ?? {}, null, 0);
      const transcript = msgs
        .map(
          (m: any) =>
            `[${new Date(m.created_at).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" })}] ${m.direction === "inbound" ? "Lead" : "Bia"}: ${m.content}`,
        )
        .join("\n");
      focusedBlock = `

LEAD EM FOCO:
${name} · ${lead.phone}
Status: ${lead.status ?? "—"} · Estágio: ${lead.stage ?? "—"}
Qualificação: ${qual}
${lead.brief ? `\nBrief:\n${lead.brief}` : ""}

Últimas mensagens:
${transcript || "(sem mensagens)"}`;
    }
  }

  const system = `${COPILOT_SYSTEM}

LEADS ATRIBUÍDOS:
${leadsList}${focusedBlock}`;

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.text }];

  // Captura o último draft proposto (se a Bia chamar propor_resposta).
  let capturedDraft: DraftProposal | undefined;

  // Loop de tool use. Cap em 5 iterações pra evitar runaway.
  const MAX_TURNS = 5;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 800,
      system,
      tools: TOOLS as unknown as Anthropic.Tool[],
      messages,
    });

    if (resp.stop_reason !== "tool_use") {
      const final = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      console.log("[copilot] final reply", {
        turn,
        stopReason: resp.stop_reason,
        inputTokens: resp.usage?.input_tokens,
        outputTokens: resp.usage?.output_tokens,
        reply: final,
        hasDraft: Boolean(capturedDraft),
      });
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
