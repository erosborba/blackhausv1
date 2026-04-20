import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import type { Empreendimento, Faq } from "./empreendimentos-shared";
import { anthropicUsage, logUsage } from "./ai-usage";

/**
 * Gera propostas de FAQ a partir do que já foi cadastrado do empreendimento
 * (campos estruturados + raw_knowledge). Não persiste — retorna a lista
 * pro corretor revisar e aprovar explicitamente.
 *
 * Intenção: o RAG profundo acumula dezenas de chunks técnicos depois de
 * alguns uploads de memorial/book. Ninguém quer ler tudo e montar FAQ na
 * mão. A IA varre, identifica perguntas que clientes de alto padrão fazem
 * ("tem pet place?", "vaga é coberta?", "qual a carga da laje?") e propõe
 * pares pergunta/resposta já destilados.
 */

export type FaqProposal = { question: string; answer: string };

export type SuggestResult =
  | { ok: true; proposals: FaqProposal[]; totalTokens: number | null }
  | { ok: false; stage: "claude" | "parse"; error: string; raw?: string };

const SUGGEST_SYSTEM = `Você é um consultor de vendas de imóveis de alto padrão escrevendo um FAQ interno pra corretores.

Dado o cadastro de UM empreendimento (campos estruturados + blocos de conhecimento bruto extraído dos documentos comerciais), proponha perguntas FREQUENTES que clientes qualificados fazem ao corretor — e as respostas exatas baseadas APENAS no conteúdo fornecido.

Retorne APENAS um objeto JSON puro (sem markdown, sem fences), no formato:

{
  "proposals": [
    { "question": string, "answer": string }
  ]
}

Regras de QUALIDADE (siga religiosamente — FAQ ruim polui o RAG e piora a IA):

1. QUANTIDADE: proponha entre 8 e 15 FAQs. Qualidade > quantidade; se o conteúdo é escasso, retorne menos.

2. EVITE O ÓBVIO: não proponha perguntas já respondidas por campos estruturados do cadastro (preço inicial, bairro, cidade, data de entrega, incorporadora, status). Se a única informação disponível é campo estruturado, NÃO crie FAQ.

3. PRIORIZE CONTEÚDO TÉCNICO do \`raw_knowledge\` — é aí que mora o valor: acabamentos por ambiente, detalhes de fachada, carga de laje, infraestrutura (gás, ar-condicionado, automação), vagas (cobertas/descobertas, carro grande, carregador elétrico), pets, lavanderia, depósitos, financiamento direto, condições comerciais, garantias, memorial descritivo, especificações.

4. FOQUE NO CORRETOR REAL: perguntas que realmente caem no dia-a-dia. Exemplos bons:
   - "Tem pet place?" / "Aceita animais de grande porte?"
   - "Vaga de garagem comporta SUV grande?"
   - "Tem ponto de carregador para veículo elétrico?"
   - "Qual a metragem da varanda gourmet?"
   - "O piso é laminado ou porcelanato?"
   - "Tem ar-condicionado instalado ou só infraestrutura?"
   - "Qual o valor do condomínio?"
   - "Aceita financiamento direto com a construtora?"

5. RESPOSTAS PRECISAS: use os TERMOS EXATOS do conteúdo (medidas, marcas, materiais). Nada de parafrasear perdendo especificidade. Se a info não está completa, escreva a resposta parcial e sinalize (ex: "Sim, tem pet place no térreo. [Dimensões não especificadas no memorial]"). Se a info NÃO EXISTE no conteúdo, NÃO crie a FAQ — invenção é proibida.

6. NÃO DUPLIQUE FAQ EXISTENTE: você vai receber a lista de FAQs já cadastradas. Não proponha nada semanticamente equivalente (mesmo que redigido diferente). Melhor propor menos do que repetir.

7. TOM: resposta em 1-3 frases, em português brasileiro, direto ao ponto. Sem "Olá!", sem "Claro!", sem emoji. O corretor vai ler pra responder o cliente, não é mensagem.

8. ESCOPO: APENAS este empreendimento. Nunca compare com outros, nunca fale de mercado em geral, nunca extrapole.`;

function buildUserContent(emp: Empreendimento, existing: Faq[]): string {
  const structured = {
    nome: emp.nome,
    construtora: emp.construtora,
    status: emp.status,
    endereco: emp.endereco,
    bairro: emp.bairro,
    cidade: emp.cidade,
    estado: emp.estado,
    preco_inicial: emp.preco_inicial,
    entrega: emp.entrega,
    tipologias: emp.tipologias ?? [],
    diferenciais: emp.diferenciais ?? [],
    lazer: emp.lazer ?? [],
    descricao: emp.descricao,
  };

  // `raw_knowledge` pode ser grande; serializamos todo mas avisamos a
  // estrutura pra IA não confundir com campos estruturados.
  const rawBlocks = (emp.raw_knowledge ?? []).map((r, i) => ({
    idx: i,
    section: r.section,
    source_file: r.source_file,
    text: r.text,
  }));

  const existingList = existing.map((f) => ({ question: f.question, answer: f.answer }));

  return [
    "## Campos estruturados do empreendimento",
    "```json",
    JSON.stringify(structured, null, 2),
    "```",
    "",
    `## Conhecimento bruto (${rawBlocks.length} blocos)`,
    rawBlocks.length
      ? [
          "```json",
          JSON.stringify(rawBlocks, null, 2),
          "```",
        ].join("\n")
      : "_(nenhum bloco de conhecimento bruto ainda — base pobre; proponha poucas FAQs ou nenhuma)_",
    "",
    `## FAQs já cadastradas (${existingList.length})`,
    existingList.length
      ? [
          "```json",
          JSON.stringify(existingList, null, 2),
          "```",
          "",
          "NÃO duplique nenhuma dessas — mesmo que redigidas de forma diferente.",
        ].join("\n")
      : "_(nenhuma FAQ cadastrada ainda)_",
    "",
    "Proponha as FAQs conforme as regras. Retorne APENAS o JSON.",
  ].join("\n");
}

export async function suggestFaqs(emp: Empreendimento, existing: Faq[]): Promise<SuggestResult> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const userText = buildUserContent(emp, existing);

  let jsonText = "";
  let totalTokens: number | null = null;
  const t0 = Date.now();
  try {
    const resp = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SUGGEST_SYSTEM,
      messages: [{ role: "user", content: userText }],
    });
    jsonText = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const u = anthropicUsage(resp);
    totalTokens = (u.inputTokens + u.outputTokens) || null;
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "faq_suggest",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      durationMs: Date.now() - t0,
      empreendimentoId: emp.id,
      metadata: { existing_faqs: existing.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[faq-suggest] anthropic error:", msg);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "faq_suggest",
      durationMs: Date.now() - t0,
      empreendimentoId: emp.id,
      ok: false,
      error: msg,
    });
    return { ok: false, stage: "claude", error: msg };
  }

  try {
    const cleaned = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as {
      proposals?: Array<{ question?: unknown; answer?: unknown }>;
    };
    const proposals: FaqProposal[] = (parsed.proposals ?? [])
      .map((p) => ({
        question: typeof p.question === "string" ? p.question.trim() : "",
        answer: typeof p.answer === "string" ? p.answer.trim() : "",
      }))
      .filter((p) => p.question.length >= 3 && p.answer.length >= 3);

    console.log("[faq-suggest] done", {
      proposals: proposals.length,
      tokens: totalTokens,
    });

    return { ok: true, proposals, totalTokens };
  } catch (e) {
    console.error("[faq-suggest] JSON parse failed:", e, jsonText.slice(0, 500));
    return {
      ok: false,
      stage: "parse",
      error: "Claude retornou JSON inválido",
      raw: jsonText.slice(0, 2000),
    };
  }
}
