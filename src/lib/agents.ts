import { supabaseAdmin } from "./supabase";

export type Agent = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  telegram_chat_id: string | null;
  last_assigned_at: string | null;
  current_lead_id: string | null;
};

// Cache simples de telefones de corretores — webhook consulta em toda mensagem.
// TTL curto porque mudanças são raras. Invalidado manualmente em mutações.
let phoneCache: { set: Set<string>; expiresAt: number } | null = null;
const PHONE_CACHE_TTL_MS = 30_000;

export function invalidateAgentCache() {
  phoneCache = null;
}

export async function isAgentPhone(phone: string): Promise<boolean> {
  const now = Date.now();
  if (!phoneCache || phoneCache.expiresAt < now) {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("agents").select("phone").eq("active", true);
    if (error) {
      console.error("[agents] isAgentPhone query failed:", error.message);
      return false;
    }
    phoneCache = {
      set: new Set((data ?? []).map((r) => r.phone)),
      expiresAt: now + PHONE_CACHE_TTL_MS,
    };
  }
  return phoneCache.set.has(phone);
}

export async function getAgentByPhone(phone: string): Promise<Agent | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("agents")
    .select("*")
    .eq("phone", phone)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error("[agents] getAgentByPhone:", error.message);
    return null;
  }
  return (data as Agent | null) ?? null;
}

export async function getAgentById(id: string): Promise<Agent | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("agents").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[agents] getAgentById:", error.message);
    return null;
  }
  return (data as Agent | null) ?? null;
}

/**
 * Escolhe o próximo corretor no rodízio, pulando `excludeIds` (usado em escalação
 * pra não devolver pro mesmo corretor que já deixou passar). Ordem: ativo,
 * `last_assigned_at NULLS FIRST` asc (quem recebeu há mais tempo vai primeiro).
 */
export async function nextInRotation(excludeIds: string[] = []): Promise<Agent | null> {
  const sb = supabaseAdmin();
  let q = sb
    .from("agents")
    .select("*")
    .eq("active", true)
    .order("last_assigned_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(1);
  if (excludeIds.length > 0) {
    q = q.not("id", "in", `(${excludeIds.join(",")})`);
  }
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error("[agents] nextInRotation:", error.message);
    return null;
  }
  return (data as Agent | null) ?? null;
}

export async function markAssigned(agentId: string, leadId: string | null) {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("agents")
    .update({
      last_assigned_at: new Date().toISOString(),
      current_lead_id: leadId,
    })
    .eq("id", agentId);
  if (error) console.error("[agents] markAssigned:", error.message);
}

export async function clearCurrentLead(agentId: string) {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("agents")
    .update({ current_lead_id: null })
    .eq("id", agentId);
  if (error) console.error("[agents] clearCurrentLead:", error.message);
}
