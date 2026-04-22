import { supabaseAdmin } from "./supabase";
import type { Empreendimento } from "./empreendimentos-shared";

/**
 * Helpers server-only pra enriquecer o ContextRail com dados que não
 * vivem em `leads` diretamente:
 *   - `getAgentName`: resolve o corretor humano atribuído
 *   - `getTopEmpreendimentoFromMessages`: deriva o empreendimento mais
 *     citado pelo retrieval da Bia nas últimas mensagens (quem ela tem
 *     recomendado ao lead)
 *
 * Ambos toleram falha — retornam null em vez de jogar, já que são
 * decoração do perfil, não parte crítica da thread.
 */

export async function getAgentName(agentId: string | null | undefined): Promise<string | null> {
  if (!agentId) return null;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("agents")
    .select("name")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { name: string | null }).name ?? null;
}

/** Sumário leve do empreendimento pra renderizar mini-card no ContextRail. */
export type TopEmpreendimento = Pick<
  Empreendimento,
  | "id"
  | "nome"
  | "slug"
  | "bairro"
  | "cidade"
  | "entrega"
  | "preco_inicial"
  | "tipologias"
  | "status"
> & {
  /** Quantas vezes esse empreendimento foi citado nas últimas N msgs. */
  citations: number;
};

type MessageSourceRow = {
  empreendimentoId: string;
  nome?: string;
  slug?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  score?: number | null;
};

/**
 * Varre as últimas 30 mensagens do lead, conta citações em `messages.sources`
 * e retorna o empreendimento mais frequente (empatando, o mais recente vence).
 * Depois busca detalhes completos da tabela `empreendimentos`.
 */
export async function getTopEmpreendimentoFromMessages(
  leadId: string,
): Promise<TopEmpreendimento | null> {
  const sb = supabaseAdmin();
  const { data: msgs, error } = await sb
    .from("messages")
    .select("sources, created_at")
    .eq("lead_id", leadId)
    .not("sources", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error || !msgs || msgs.length === 0) return null;

  // Count citations; also track last-seen time for tie-break.
  const counts = new Map<string, number>();
  const lastSeen = new Map<string, string>();

  for (const row of msgs as Array<{ sources: MessageSourceRow[] | null; created_at: string }>) {
    if (!Array.isArray(row.sources)) continue;
    const seenInMsg = new Set<string>();
    for (const src of row.sources) {
      if (!src?.empreendimentoId || seenInMsg.has(src.empreendimentoId)) continue;
      seenInMsg.add(src.empreendimentoId);
      counts.set(src.empreendimentoId, (counts.get(src.empreendimentoId) ?? 0) + 1);
      if (!lastSeen.has(src.empreendimentoId)) lastSeen.set(src.empreendimentoId, row.created_at);
    }
  }

  if (counts.size === 0) return null;

  // Pick winner: max count, then most recent last-seen.
  let winner: string | null = null;
  let winnerCount = 0;
  let winnerTime = "";
  for (const [id, c] of counts) {
    const t = lastSeen.get(id) ?? "";
    if (c > winnerCount || (c === winnerCount && t > winnerTime)) {
      winner = id;
      winnerCount = c;
      winnerTime = t;
    }
  }
  if (!winner) return null;

  const { data: emp, error: empErr } = await sb
    .from("empreendimentos")
    .select("id, nome, slug, bairro, cidade, entrega, preco_inicial, tipologias, status")
    .eq("id", winner)
    .maybeSingle();
  if (empErr || !emp) return null;

  return {
    ...(emp as Omit<TopEmpreendimento, "citations">),
    citations: winnerCount,
  };
}
