import { supabaseAdmin } from "./supabase";
import type { HandoffReason, HandoffUrgency } from "./handoff-copy";

export type Qualification = {
  tipo?: "apartamento" | "casa" | "cobertura" | "studio";
  quartos?: number;
  faixa_preco_min?: number;
  faixa_preco_max?: number;
  bairros?: string[];
  cidade?: string;
  finalidade?: "moradia" | "investimento";
  prazo?: "imediato" | "3-6m" | "6-12m" | "+12m";
  pagamento?: "a_vista" | "financiamento";
  usa_fgts?: boolean;
  usa_mcmv?: boolean;
  /**
   * Renda bruta mensal familiar em BRL. Adicionado em Track 3 · 3.5b
   * pra alimentar `check_mcmv` (faixas dependem de renda) e calibrar
   * `simulate_financing` (conforto com parcela). Campo opcional — só
   * aparece quando o lead declara voluntariamente ou Bia pergunta.
   */
  renda?: number;
  /**
   * Lead declarou que é o primeiro imóvel (critério legal MCMV).
   * Track 3 · 3.5b. Só `true`/`false` quando o lead confirma
   * explicitamente — `undefined` = ainda não perguntado.
   */
  primeiro_imovel?: boolean;
};

export type Lead = {
  id: string;
  phone: string;
  push_name: string | null;
  full_name: string | null;
  status: string;
  stage: string | null;
  qualification: Qualification;
  human_takeover: boolean;
  agent_notes?: string | null;
  brief?: string | null;
  brief_at?: string | null;
  assigned_agent_id?: string | null;
  bridge_active?: boolean;
  handoff_notified_at?: string | null;
  handoff_attempts?: number;
  memory?: string | null;
  memory_updated_at?: string | null;
  memory_msg_count?: number;
  score?: number;
  score_updated_at?: string | null;
  handoff_reason?: HandoffReason | null;
  handoff_urgency?: HandoffUrgency | null;
};

export async function upsertLead(phone: string, pushName?: string): Promise<Lead> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("leads")
    .upsert(
      { phone, push_name: pushName, last_message_at: new Date().toISOString() },
      { onConflict: "phone", ignoreDuplicates: false },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as Lead;
}

export async function updateLead(id: string, patch: Partial<Lead> & { qualification?: Qualification }) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("leads").update(patch).eq("id", id);
  if (error) throw error;
}

export async function appendMessage(args: {
  leadId: string;
  direction: "inbound" | "outbound";
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  evolutionMessageId?: string;
  evolutionEvent?: unknown;
  mediaType?: "audio" | "image" | "video" | null;
  mediaPath?: string | null;
  mediaMime?: string | null;
  mediaDurationMs?: number | null;
  /**
   * Retrieval provenance: empreendimentos que alimentaram a resposta.
   * UI do /inbox mostra como pill abaixo do bubble outbound.
   */
  sources?: unknown[] | null;
}) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("messages").insert({
    lead_id: args.leadId,
    direction: args.direction,
    role: args.role,
    content: args.content,
    evolution_message_id: args.evolutionMessageId,
    evolution_event: args.evolutionEvent,
    media_type: args.mediaType ?? null,
    media_path: args.mediaPath ?? null,
    media_mime: args.mediaMime ?? null,
    media_duration_ms: args.mediaDurationMs ?? null,
    sources: args.sources && args.sources.length > 0 ? args.sources : null,
  });
  if (error) {
    // 23505 = unique_violation no índice de evolution_message_id.
    // Significa que outro processo já gravou essa mensagem — idempotente, ok.
    if ((error as { code?: string }).code === "23505") {
      console.log("[leads] appendMessage: dedup por unique index", args.evolutionMessageId);
      return;
    }
    throw error;
  }
}

export async function recentMessages(leadId: string, limit = 20) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("messages")
    .select("role, content, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}
