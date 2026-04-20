import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import { anthropicUsage, logUsage } from "./ai-usage";
import { getSettingNumber } from "./settings";

/**
 * Memória persistente do lead (Fatia I).
 *
 * Objetivo: reduzir o que a Bia "esquece entre sessões". Em vez de depender
 * só das últimas 12 mensagens, mantemos um resumo em prose (~200-300 palavras)
 * que condensa tudo que importa — preferências implícitas, objeções,
 * personalidade, urgência, restrições soft.
 *
 * Modelo: **Haiku**. Tarefa é rescrita/resumo, Sonnet seria overkill e caro.
 * A memória é atualizada INCREMENTALMENTE — Haiku recebe a memória atual +
 * últimas mensagens e decide o que manter/editar/acrescentar. Isso evita que
 * cresça sem controle e mantém a continuidade entre refreshes.
 */

// Modelo fixo (não via env) pra garantir que memória roda com o mais barato.
// Se um dia Haiku sair, mudar aqui.
const MEMORY_MODEL = "claude-haiku-4-5";

// A cada N mensagens novas desde o último refresh, rodamos de novo.
// 8 é o sweet spot: curto o bastante pra capturar mudança de rumo, longo o
// bastante pra não gastar token à toa em "oi" / "ok" / "rsrs".
export const MEMORY_REFRESH_EVERY = 8;

// Quantas mensagens recentes passar pro Haiku no refresh.
// 20 cobre ~últimas 2 sessões típicas, sem estourar input.
const RECENT_MSGS_WINDOW = 20;

const MEMORY_SYSTEM = `Você mantém a MEMÓRIA PERSISTENTE de um lead imobiliário (cliente em atendimento da Bia, SDR IA).

Você recebe:
1. A memória atual do lead (pode estar vazia na primeira vez).
2. As últimas mensagens do lead com a Bia.
3. O JSON de qualificação estruturada atual.

Sua tarefa: retornar uma NOVA memória atualizada — em prose, pt-BR, 3-6 parágrafos curtos separados por linha em branco, total ~200-300 palavras.

A memória deve capturar:
- Perfil implícito: tom/humor, grau de formalidade, nível de urgência percebido.
- Preferências soft (não-estruturadas): "prefere prédios novos", "evita térreo", "quer vista", "não curte área comum grande".
- Restrições/objeções: "não quer MCMV", "acha caro acima de X", "só Centro ou Batel".
- Contexto de vida relevante: "vai casar em 6 meses", "está vendendo imóvel antes", "mudança do exterior".
- Histórico de decisões: empreendimentos que já olhou/descartou e por quê.
- Perguntas já respondidas pela Bia que não vale a pena responder de novo.

NÃO inclua na memória:
- Dados que já estão no JSON de qualificação (tipo, quartos, cidade, faixa_preço, prazo, pagamento, FGTS, MCMV). Esses são redundantes.
- Transcrições literais. Sintetize.
- Suposições sem evidência nas mensagens.
- Informações desatualizadas se o lead mudou de ideia (ex.: disse "Batel" e depois "mudei pra Água Verde" → só "Água Verde").

Regras de manutenção:
- Se a memória atual tem info contradita pelas novas mensagens, ATUALIZE (não mantenha as duas versões).
- Se um fato virou irrelevante (ex.: objeção já superada), REMOVA.
- Mantenha tom descritivo, 3ª pessoa, sem julgamento ("Lead parece decidido", não "Lead é indeciso").
- NÃO use markdown com negrito/bullets. Só parágrafos.
- Se não houver nada relevante ainda (lead só mandou "oi"), responda apenas "(sem memória suficiente ainda)".

Retorne APENAS o texto da memória nova. Sem preâmbulo, sem fences, sem JSON.`;

export type RefreshResult =
  | { ok: true; memory: string; refreshed: boolean; reason: string }
  | { ok: false; error: string };

/**
 * Verifica se o lead precisa de refresh de memória.
 *
 * Regra: `total_msgs - memory_msg_count >= MEMORY_REFRESH_EVERY`.
 * Primeira vez (`memory_updated_at` nulo) dispara depois de 3 msgs (suficiente
 * pra ter sinal — menos que isso é ruído).
 */
export async function shouldRefreshMemory(args: {
  memory_updated_at: string | null;
  memory_msg_count: number;
  total_msg_count: number;
}): Promise<boolean> {
  const { memory_updated_at, memory_msg_count, total_msg_count } = args;
  if (total_msg_count < 3) return false; // ruído
  if (!memory_updated_at) return total_msg_count >= 3;
  const every = await getSettingNumber("memory_refresh_every", MEMORY_REFRESH_EVERY);
  return total_msg_count - memory_msg_count >= every;
}

/**
 * Refresca a memória de um lead. Lê memória atual, últimas mensagens e
 * qualification, chama Haiku, grava de volta.
 *
 * Idempotente: pode rodar várias vezes sem corromper (Haiku só reescreve).
 * Bloqueia ~1-2s por causa do Haiku — use `refreshLeadMemoryAsync` pra
 * fire-and-forget.
 */
export async function refreshLeadMemory(leadId: string): Promise<RefreshResult> {
  const sb = supabaseAdmin();

  // Busca lead + contagem total de mensagens + últimas N mensagens em paralelo.
  const [leadQ, countQ, msgsQ] = await Promise.all([
    sb
      .from("leads")
      .select("memory, memory_msg_count, memory_updated_at, qualification")
      .eq("id", leadId)
      .maybeSingle(),
    sb
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", leadId),
    sb
      .from("messages")
      .select("direction, content, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(RECENT_MSGS_WINDOW),
  ]);

  if (leadQ.error || !leadQ.data) {
    return { ok: false, error: "lead não encontrado" };
  }

  const totalMsgs = countQ.count ?? 0;
  const lead = leadQ.data;

  if (
    !(await shouldRefreshMemory({
      memory_updated_at: lead.memory_updated_at,
      memory_msg_count: lead.memory_msg_count ?? 0,
      total_msg_count: totalMsgs,
    }))
  ) {
    return { ok: true, memory: lead.memory ?? "", refreshed: false, reason: "not_due" };
  }

  // Inverte (foi DESC pra pegar as mais recentes) pra ordem cronológica.
  const recentMsgs = (msgsQ.data ?? []).slice().reverse();
  if (!recentMsgs.length) {
    return { ok: true, memory: lead.memory ?? "", refreshed: false, reason: "no_messages" };
  }

  const transcript = recentMsgs
    .map((m) => `${m.direction === "inbound" ? "Lead" : "Bia"}: ${m.content}`)
    .join("\n");

  const userBlock = [
    "## Memória atual",
    lead.memory && lead.memory.trim() ? lead.memory.trim() : "_(vazia — primeira vez)_",
    "",
    "## Qualificação estruturada (NÃO duplicar na memória)",
    "```json",
    JSON.stringify(lead.qualification ?? {}, null, 2),
    "```",
    "",
    "## Últimas mensagens",
    transcript,
    "",
    "Retorne a memória atualizada conforme as regras.",
  ].join("\n");

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let newMemory = "";
  try {
    const resp = await anthropic.messages.create({
      model: MEMORY_MODEL,
      max_tokens: 800, // ~600 palavras max; prompt pede ~300
      system: MEMORY_SYSTEM,
      messages: [{ role: "user", content: userBlock }],
    });
    newMemory = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    const u = anthropicUsage(resp);
    logUsage({
      provider: "anthropic",
      model: MEMORY_MODEL,
      task: "lead_memory",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      durationMs: Date.now() - t0,
      leadId,
      metadata: { msg_count: totalMsgs, had_memory: Boolean(lead.memory) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[lead-memory] Haiku falhou:", msg);
    logUsage({
      provider: "anthropic",
      model: MEMORY_MODEL,
      task: "lead_memory",
      durationMs: Date.now() - t0,
      leadId,
      ok: false,
      error: msg,
    });
    return { ok: false, error: msg };
  }

  // Trata "(sem memória suficiente ainda)" como string vazia mesmo — evita
  // poluir o prompt com essa frase depois.
  if (/^\(sem mem[óo]ria suficiente/i.test(newMemory)) {
    newMemory = "";
  }

  const { error: updErr } = await sb
    .from("leads")
    .update({
      memory: newMemory,
      memory_msg_count: totalMsgs,
      memory_updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (updErr) {
    console.error("[lead-memory] update leads falhou:", updErr.message);
    return { ok: false, error: updErr.message };
  }

  console.log("[lead-memory] refreshed", {
    leadId,
    totalMsgs,
    newLen: newMemory.length,
    durationMs: Date.now() - t0,
  });
  return { ok: true, memory: newMemory, refreshed: true, reason: "updated" };
}

/**
 * Versão fire-and-forget. Usar no webhook depois de processar a mensagem —
 * não queremos bloquear o reply da Bia enquanto Haiku resume.
 */
export function refreshLeadMemoryAsync(leadId: string): void {
  setTimeout(() => {
    refreshLeadMemory(leadId).catch((e) => {
      console.error("[lead-memory] async refresh threw:", e);
    });
  }, 0);
}
