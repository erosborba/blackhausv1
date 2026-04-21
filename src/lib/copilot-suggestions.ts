/**
 * Vanguard · Track 3 · Slice 3.5a — DB wrapper de copilot_suggestions.
 *
 * Persistência das sugestões geradas em modo copilot pelas tools
 * financeiras. 3.5a escreve; 3.6 constrói a UI do /inbox que lê +
 * dispara envio/descarte.
 *
 * Invariants:
 *   - I-4: a parte pura (texto, números) vem da lib de finance.
 *   - I-3: reusa `leads`/`messages` existentes; não duplica dados.
 */
import { supabaseAdmin } from "./supabase";

export type CopilotSuggestionKind = "simulation" | "mcmv";
export type CopilotSuggestionStatus = "pending" | "sent" | "discarded";

export type CopilotSuggestionRow = {
  id: string;
  lead_id: string;
  kind: CopilotSuggestionKind;
  payload: Record<string, unknown>;
  text_preview: string;
  status: CopilotSuggestionStatus;
  edited_text: string | null;
  discarded_reason: string | null;
  sent_message_id: string | null;
  created_at: string;
  resolved_at: string | null;
  created_by: string | null;
  meta: Record<string, unknown> | null;
};

export type InsertSuggestionInput = {
  leadId: string;
  kind: CopilotSuggestionKind;
  payload: Record<string, unknown>;
  textPreview: string;
  createdBy?: string;
  meta?: Record<string, unknown> | null;
};

/**
 * Cria uma sugestão pending. Retorna o `id` pro wrapper referenciar
 * na resposta da tool. Em falha de DB, joga — melhor Bia pedir desculpa
 * do que fingir que gravou quando não gravou (fail-loud).
 */
export async function insertCopilotSuggestion(
  input: InsertSuggestionInput,
): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("copilot_suggestions")
    .insert({
      lead_id: input.leadId,
      kind: input.kind,
      payload: input.payload,
      text_preview: input.textPreview,
      status: "pending",
      created_by: input.createdBy ?? "bia",
      meta: input.meta ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `copilot_suggestions insert failed: ${error?.message ?? "no row"}`,
    );
  }
  return data.id as string;
}

/**
 * Lista sugestões pending de um lead. Usado pela UI do /inbox (3.6)
 * e por agents que queiram checar "já tem sugestão em voo pra este
 * lead?" antes de emitir outra.
 */
export async function listPendingSuggestionsByLead(
  leadId: string,
): Promise<CopilotSuggestionRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("copilot_suggestions")
    .select("*")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[copilot-suggestions] listPending", error.message);
    return [];
  }
  return (data ?? []) as CopilotSuggestionRow[];
}

/**
 * Marca sugestão como enviada. Chamado pela UI (3.6) depois que o
 * corretor clicou "Enviar" e o outbound foi gravado em `messages`.
 *
 * `editedText` preenchido só se o corretor ajustou o texto antes de
 * enviar — pra telemetria de quão bem a Bia escreve.
 */
export async function markSuggestionSent(args: {
  id: string;
  sentMessageId: string;
  editedText?: string | null;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("copilot_suggestions")
    .update({
      status: "sent",
      sent_message_id: args.sentMessageId,
      edited_text: args.editedText ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", args.id)
    .eq("status", "pending"); // idempotência: não reabre sugestão já resolvida
  if (error) {
    throw new Error(`copilot_suggestions markSent failed: ${error.message}`);
  }
}

/**
 * Descarta uma sugestão. `reason` é free-form pra telemetria de
 * qualidade ("taxa desatualizada", "lead já sabia", "preço errado").
 */
export async function markSuggestionDiscarded(args: {
  id: string;
  reason?: string | null;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("copilot_suggestions")
    .update({
      status: "discarded",
      discarded_reason: args.reason ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", args.id)
    .eq("status", "pending");
  if (error) {
    throw new Error(
      `copilot_suggestions markDiscarded failed: ${error.message}`,
    );
  }
}
