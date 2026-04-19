import { supabaseAdmin } from "./supabase";

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
}) {
  const sb = supabaseAdmin();
  const { error } = await sb.from("messages").insert({
    lead_id: args.leadId,
    direction: args.direction,
    role: args.role,
    content: args.content,
    evolution_message_id: args.evolutionMessageId,
    evolution_event: args.evolutionEvent,
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
