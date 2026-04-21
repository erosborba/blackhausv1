import type { DraftAction, DraftConfidence } from "@/lib/drafts";

/**
 * Shape consumido pela UI do /revisao — já aplanado (leads/agents
 * como objetos singulares, não arrays do Supabase).
 */
export type DraftWithRefs = {
  id: string;
  lead_id: string;
  agent_id: string | null;
  proposed_text: string;
  confidence: DraftConfidence;
  action: DraftAction;
  final_text: string | null;
  created_at: string;
  acted_at: string | null;
  leads: {
    phone: string | null;
    push_name: string | null;
    full_name: string | null;
  } | null;
  agents: { name: string } | null;
};

export type RevisaoStats = {
  total: number;
  approved: number;
  edited: number;
  proposed: number;
  ignored: number;
  byConfidence: Record<
    DraftConfidence,
    { total: number; approved: number; edited: number; proposed: number; ignored: number }
  >;
};

/** Taxa "aprovada sem edição" — o número que importa pra liberar auto-send. */
export function approvalPct(bucket: { total: number; approved: number }): number | null {
  if (bucket.total === 0) return null;
  return Math.round((bucket.approved / bucket.total) * 100);
}
