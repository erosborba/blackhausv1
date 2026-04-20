import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { reindexEmpreendimento } from "@/lib/empreendimentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const faqSchema = z.object({
  question: z.string().trim().min(3, "pergunta muito curta"),
  answer: z.string().trim().min(3, "resposta muito curta"),
  source: z.enum(["manual", "ai_generated"]).default("manual"),
});

/** GET /api/admin/empreendimentos/[id]/faqs — lista FAQs do empreendimento. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimento_faqs")
    .select("*")
    .eq("empreendimento_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

/**
 * POST /api/admin/empreendimentos/[id]/faqs — cria FAQ nova.
 *
 * Re-indexa o RAG best-effort. FAQ nova sem indexar ainda é útil (fica
 * visível pro corretor), mas a Bia só vai usá-la depois do reindex.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = faqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimento_faqs")
    .insert({ empreendimento_id: id, ...parsed.data })
    .select("*")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Reindex awaited: previne race com pergunta na Bia logo após o POST
  // (se era fire-and-forget, o chunk podia não existir ainda em
  // `empreendimento_chunks` quando o embed da pergunta rodasse).
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[faqs POST] reindex threw:", e);
  }

  return NextResponse.json({ ok: true, data, indexed });
}
