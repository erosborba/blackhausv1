import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import { anthropicUsage, logUsage } from "./ai-usage";

const BRIEF_SYSTEM = `Você é um assistente que resume conversas de qualificação SDR imobiliário em briefings curtos e acionáveis para o corretor que vai assumir o atendimento.

Receberá o histórico da conversa (lead ↔ Bia) e o JSON de qualificação atual. Produza um briefing em pt-BR com até 180 palavras no formato abaixo:

**Perfil**
- (nome do lead, como gosta de ser tratado, tom/humor percebido)

**Qualificação**
- Tipo / quartos / cidade-bairros
- Faixa de preço
- Prazo, forma de pagamento, FGTS/MCMV (se mencionados)
- Campos ainda faltantes

**Contexto da conversa**
- 1-3 bullets sobre pontos importantes (objeções, urgência, empreendimentos mencionados, dúvidas abertas)

**Próxima ação sugerida**
- Uma frase clara sobre o que o corretor deve fazer agora.

Regras:
- NÃO invente dados que não estão no histórico ou na qualificação.
- Seja conciso. Sem floreio.
- Não repita blocos vazios — se não tiver dado pra "Perfil", pule.
- Use markdown simples (negrito, bullets). Não use títulos H1/H2.`;

export async function generateBrief(leadId: string): Promise<string> {
  const sb = supabaseAdmin();
  const [leadQ, msgsQ] = await Promise.all([
    sb
      .from("leads")
      .select("phone, push_name, full_name, qualification, status, stage, memory")
      .eq("id", leadId)
      .maybeSingle(),
    sb
      .from("messages")
      .select("direction, content, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(80),
  ]);
  if (leadQ.error || !leadQ.data) throw new Error("lead não encontrado");
  const lead = leadQ.data;
  const messages = msgsQ.data ?? [];

  const name = lead.full_name || lead.push_name || lead.phone;
  const transcript = messages
    .map((m) => `${m.direction === "inbound" ? name : "Bia"}: ${m.content}`)
    .join("\n");

  // Memória persistente (Fatia I) já é um resumo denso do lead — se
  // existir, ajuda muito o brief (o LLM não precisa re-destilar o perfil
  // a partir da transcrição bruta).
  const memoryBlock =
    lead.memory && lead.memory.trim()
      ? `MEMÓRIA ACUMULADA DO LEAD (contexto de sessões anteriores):
${lead.memory.trim()}

`
      : "";

  const userBlock = `LEAD: ${name} (${lead.phone})
STATUS: ${lead.status ?? "—"} · ESTÁGIO: ${lead.stage ?? "—"}

${memoryBlock}QUALIFICAÇÃO ATUAL (JSON):
${JSON.stringify(lead.qualification ?? {}, null, 2)}

HISTÓRICO DA CONVERSA:
${transcript || "(sem mensagens)"}`;

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const resp = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 600,
    system: BRIEF_SYSTEM,
    messages: [{ role: "user", content: userBlock }],
  });
  const u = anthropicUsage(resp);
  logUsage({
    provider: "anthropic",
    model: env.ANTHROPIC_MODEL,
    task: "brief",
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    durationMs: Date.now() - t0,
    leadId,
    metadata: { msg_count: messages.length },
  });
  const text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return text;
}
