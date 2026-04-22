/**
 * Vanguard · Track 3 · Slice 3.6a — endpoint pra corretor enviar sugestão.
 *
 * Fluxo:
 *   1. Valida sessão (só corretor logado manda).
 *   2. Lê sugestão (precisa existir + estar pending + lead referenciado).
 *   3. Decide texto final: `editedText` do body se veio, senão `text_preview`.
 *   4. Envia via Evolution.
 *   5. Grava em `messages` — role="assistant" porque a sugestão foi ESCRITA
 *      pela Bia (mesmo que o corretor tenha revisado). Isso mantém a cor
 *      da bolha no /inbox (Bia) coerente com quem produziu o texto; a
 *      telemetria de `edited_text` rastreia se houve edição humana.
 *   6. Marca sugestão como sent com `sent_message_id` do row de messages.
 *   7. Fecha o handoff pending desta sugestão (se houver) — sugestão
 *      enviada é revisão resolvida; não faz sentido manter corretor
 *      sendo cobrado a olhar de novo.
 *
 * Diferença crítica vs `/api/leads/[id]/send`:
 *   - NÃO ativa `human_takeover`. Sugestão é "corretor faz override
 *     pontual da Bia com revisão do cálculo" — a Bia continua no comando
 *     do fluxo geral. Se o corretor quiser assumir, usa /takeover.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { sendText } from "@/lib/evolution";
import { getSession } from "@/lib/auth/session";
import { markSuggestionSent } from "@/lib/copilot-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Texto editado pelo corretor. Se omitido, usa `text_preview` original. */
  editedText: z.string().min(1).max(4000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { agent } = await getSession();
  if (!agent) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { editedText } = parsed.data;

  const sb = supabaseAdmin();

  const { data: suggestion, error: sugErr } = await sb
    .from("copilot_suggestions")
    .select("id, lead_id, status, text_preview")
    .eq("id", id)
    .maybeSingle();

  if (sugErr) {
    return NextResponse.json({ ok: false, error: sugErr.message }, { status: 500 });
  }
  if (!suggestion) {
    return NextResponse.json({ ok: false, error: "suggestion_not_found" }, { status: 404 });
  }
  if (suggestion.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "suggestion_not_pending", status: suggestion.status },
      { status: 409 },
    );
  }

  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, phone, handoff_notified_at, handoff_resolved_at")
    .eq("id", suggestion.lead_id)
    .maybeSingle();

  if (leadErr) {
    return NextResponse.json({ ok: false, error: leadErr.message }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const finalText = editedText ?? suggestion.text_preview;
  const wasEdited = editedText !== undefined && editedText !== suggestion.text_preview;

  try {
    await sendText({ to: lead.phone, text: finalText, delayMs: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[suggestions/send] evolution send failed:", msg);
    return NextResponse.json(
      { ok: false, error: "evolution_failed", detail: msg },
      { status: 502 },
    );
  }

  // Grava em messages. role="assistant" porque a origem do texto é Bia.
  const { data: msgRow, error: msgErr } = await sb
    .from("messages")
    .insert({
      lead_id: suggestion.lead_id,
      direction: "outbound",
      role: "assistant",
      content: finalText,
    })
    .select("id")
    .single();

  if (msgErr || !msgRow) {
    // Msg já foi pra Evolution; registramos mesmo assim pra não perder rastreio.
    console.warn(
      "[suggestions/send] messages insert failed (msg já enviou):",
      msgErr?.message,
    );
  }

  // Marca sugestão como sent (idempotente por `status = 'pending'` no update).
  try {
    await markSuggestionSent({
      id: suggestion.id,
      sentMessageId: msgRow?.id ?? "",
      editedText: wasEdited ? finalText : null,
    });
  } catch (e) {
    console.error("[suggestions/send] markSent failed:", e);
    // Não reverte: msg já foi.
  }

  // Fecha handoff pending relacionado, se houver — sugestão enviada é
  // revisão concluída. Evita o corretor ficar cobrado duas vezes.
  if (lead.handoff_notified_at && !lead.handoff_resolved_at) {
    await sb
      .from("leads")
      .update({ handoff_resolved_at: new Date().toISOString() })
      .eq("id", suggestion.lead_id);
  }

  await sb
    .from("leads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", suggestion.lead_id);

  return NextResponse.json({ ok: true, edited: wasEdited });
}
