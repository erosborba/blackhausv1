import { supabaseAdmin } from "./supabase";

/**
 * Kinds reconhecidos na timeline do lead. Nova chave? Adicione aqui + UI
 * (src/components/inbox/Timeline.tsx) pra ter label/ícone.
 *
 * Fire-and-forget: timeline é observabilidade, não é caminho crítico. Se
 * der erro, só loga e segue — não derruba fluxo do webhook.
 */
export type LeadEventKind =
  | "status_change"
  | "stage_change"
  | "handoff_requested"
  | "handoff_resolved"
  | "assigned"
  | "bridge_opened"
  | "bridge_closed"
  | "draft_edited"
  | "memory_refreshed"
  | "factcheck_blocked"
  | "score_jump"
  | "note_added"
  | "handoff_feedback";

export type EmitLeadEventArgs = {
  leadId: string;
  kind: LeadEventKind;
  payload?: Record<string, unknown>;
  actor?: string | null;
};

export async function emitLeadEvent(args: EmitLeadEventArgs): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("lead_events").insert({
      lead_id: args.leadId,
      kind: args.kind,
      payload: args.payload ?? {},
      actor: args.actor ?? "system",
    });
    if (error) {
      console.warn("[lead_events] insert falhou", args.kind, error.message);
    }
  } catch (e) {
    console.warn("[lead_events] insert exception", args.kind, e);
  }
}
