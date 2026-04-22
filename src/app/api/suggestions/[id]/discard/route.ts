/**
 * Vanguard · Track 3 · Slice 3.6a — endpoint pra corretor descartar sugestão.
 *
 * Descartar = "a Bia sugeriu mas eu não vou mandar". Pode ser que o
 * cálculo estava errado, que o lead já sabia, que o timing não colou.
 * O campo `reason` é free-form pra telemetria — input do /ajustes em
 * 3.6b restringe pra enum, mas o schema da tabela aceita qualquer string.
 *
 * Igual ao send, fecha o handoff pending — revisão resolvida.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/auth/session";
import { markSuggestionDiscarded } from "@/lib/copilot-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /**
   * Motivo do descarte. Free-form em 3.6a; 3.6b vai popular isto a
   * partir de dropdown em /ajustes. Máx 200 chars pra forçar sucinto.
   */
  reason: z.string().max(200).optional(),
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
  const { reason } = parsed.data;

  const sb = supabaseAdmin();

  const { data: suggestion, error: sugErr } = await sb
    .from("copilot_suggestions")
    .select("id, lead_id, status")
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

  try {
    await markSuggestionDiscarded({ id: suggestion.id, reason: reason ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  // Fecha handoff pending deste lead — revisão descartada também resolve.
  const { data: lead } = await sb
    .from("leads")
    .select("handoff_notified_at, handoff_resolved_at")
    .eq("id", suggestion.lead_id)
    .maybeSingle();

  if (lead?.handoff_notified_at && !lead.handoff_resolved_at) {
    await sb
      .from("leads")
      .update({ handoff_resolved_at: new Date().toISOString() })
      .eq("id", suggestion.lead_id);
  }

  return NextResponse.json({ ok: true });
}
