import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import type { Agent } from "./agents";

/**
 * Bia no modo copiloto do corretor.
 *
 * Quando o corretor manda texto solto no WhatsApp (sem quote, sem /lead),
 * não encaminhamos nada ao cliente — respondemos como assistente dele.
 * Útil pra: "quais meus leads?", "qual o orçamento do João?", "sugere uma
 * resposta pra ele", "me lembra o brief".
 *
 * Injetamos contexto: lista de leads atribuídos + lead em foco (se houver
 * `current_lead_id`) com qualificação, brief e últimas mensagens.
 */

const COPILOT_SYSTEM = `Você é a Bia, assistente inteligente do corretor no sistema Blackhaus (vendas imobiliárias em Curitiba).

Modo atual: **copiloto do corretor** (não está conversando com o lead).
• Ajude o corretor a gerenciar os leads que a Bia qualificou.
• Responda dúvidas, sugira abordagens, lembre contexto, proponha próximas ações.
• Seja concisa e acionável. pt-BR, tom informal profissional.

Se o corretor pedir "responde pra ele X" ou "manda Y pro lead", LEMBRE que pra enviar ao cliente ele precisa:
  • Usar "Responder" (quote) numa mensagem do lead/notificação; OU
  • Digitar: /lead <telefone> <mensagem>

Comandos que o corretor pode usar:
  /status — lista leads atribuídos
  /lead <telefone> <mensagem> — envia ao lead sem precisar de quote
  /fim — encerra ponte do lead em foco
  /help — lista comandos`;

export async function brokerCopilot(args: {
  agent: Agent;
  text: string;
}): Promise<string> {
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
  const resp = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: "user", content: args.text }],
  });
  return resp.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
