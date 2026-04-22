import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { appendMessage } from "@/lib/leads";
import { sendText } from "@/lib/evolution";
import { closeBridge } from "@/lib/handoff";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  /** Se true, devolve o controle pra IA após mandar (corretor mandou e some). */
  returnToIa: z.boolean().optional().default(false),
  /** Se true, pausa a IA antes de mandar. Default: true (corretor tá no controle). */
  takeover: z.boolean().optional().default(true),
});

/**
 * POST /api/leads/[id]/send
 *
 * Corretor envia mensagem pro lead via WhatsApp (Evolution). Fluxo:
 *  1. Valida sessão (precisa estar logado).
 *  2. Lê lead pra pegar phone.
 *  3. Opcionalmente marca human_takeover=true (pausa a Bia).
 *  4. Envia via Evolution API.
 *  5. Grava em messages (direction=outbound, role=user — é o corretor, não a IA).
 *  6. Opcionalmente devolve pra IA (human_takeover=false).
 *
 * Resposta: { ok, messageId? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { agent } = await getSession();
  if (!agent) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { message, returnToIa, takeover } = parsed.data;

  const sb = supabaseAdmin();
  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, phone, human_takeover")
    .eq("id", id)
    .maybeSingle();

  if (leadErr) {
    return NextResponse.json({ ok: false, error: leadErr.message }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  // Pausa Bia se o corretor ainda não tinha assumido
  if (takeover && !lead.human_takeover) {
    await sb
      .from("leads")
      .update({ human_takeover: true, assigned_agent_id: agent.id })
      .eq("id", id);
  }

  // Envia pelo WhatsApp
  try {
    await sendText({ to: lead.phone, text: message, delayMs: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send] evolution send failed:", msg);
    return NextResponse.json(
      { ok: false, error: "evolution_failed", detail: msg },
      { status: 502 },
    );
  }

  // Grava no histórico — role "user" indica que não foi a IA.
  // (O webhook Evolution também receberá o echo e deduplicará por evolution_message_id.)
  try {
    await appendMessage({
      leadId: id,
      direction: "outbound",
      role: "user",
      content: message,
    });
  } catch (e) {
    console.warn("[send] appendMessage failed:", e);
    // não rejeita — a msg já foi enviada; webhook reconcilia
  }

  // Atualiza last_message_at
  await sb
    .from("leads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", id);

  // Opcionalmente devolve pra IA: fecha ponte (se aberta) + zera human_takeover.
  // Usa closeBridge pra alinhar com /fim e com DELETE /takeover (mesma semântica).
  if (returnToIa) {
    await closeBridge(id);
  }

  return NextResponse.json({ ok: true });
}
