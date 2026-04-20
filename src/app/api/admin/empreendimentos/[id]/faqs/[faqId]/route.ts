import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { reindexEmpreendimento } from "@/lib/empreendimentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; faqId: string }> };

// PATCH permite edição parcial — às vezes o corretor só quer corrigir a
// resposta sem mexer na pergunta (ou vice-versa).
const patchSchema = z
  .object({
    question: z.string().trim().min(3).optional(),
    answer: z.string().trim().min(3).optional(),
    source: z.enum(["manual", "ai_generated"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nada para atualizar" });

/** PATCH /api/admin/empreendimentos/[id]/faqs/[faqId] — edita FAQ. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, faqId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimento_faqs")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", faqId)
    .eq("empreendimento_id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Reindex awaited — question/answer mudou, chunk antigo precisa sumir do RAG
  // antes da próxima pergunta.
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[faqs PATCH] reindex threw:", e);
  }

  return NextResponse.json({ ok: true, data, indexed });
}

/** DELETE /api/admin/empreendimentos/[id]/faqs/[faqId] — remove FAQ. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id, faqId } = await ctx.params;
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("empreendimento_faqs")
    .delete()
    .eq("id", faqId)
    .eq("empreendimento_id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Reindex awaited — chunk da FAQ removida precisa sumir do RAG antes da
  // próxima pergunta (senão a Bia pode citar FAQ deletada).
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[faqs DELETE] reindex threw:", e);
  }

  return NextResponse.json({ ok: true, indexed });
}
