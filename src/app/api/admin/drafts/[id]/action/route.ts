import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/drafts/:id/action
 *
 * Corpo: { action: "approved" | "edited" | "ignored", final_text?: string | null }
 *
 * Ação do corretor sobre um draft proposto pela Bia. A resposta é só
 * {ok}. O UI do /revisao aplica estado otimista, por isso não tem eco.
 *
 * NB: o envio do WhatsApp não é feito aqui — essa rota só registra a
 * decisão. O corretor continua enviando pelo handoff normal; este
 * endpoint serve pra medir taxa de aprovação e treinar future auto-send.
 */
const bodySchema = z.object({
  action: z.enum(["approved", "edited", "ignored"]),
  final_text: z.string().nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getCurrentRole();
  if (!can(role, "revisao.approve")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid body";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("drafts")
    .update({
      action: body.action,
      final_text: body.action === "ignored" ? null : (body.final_text ?? null),
      acted_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[api/admin/drafts/action]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
