import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { suggestFaqs } from "@/lib/empreendimentos-faq-suggest";
import type { Empreendimento, Faq } from "@/lib/empreendimentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/empreendimentos/[id]/faqs/suggest
 *
 * Propõe FAQs via Claude baseado em raw_knowledge + estruturados + FAQs
 * já cadastradas (pra não duplicar). NÃO salva — retorna proposals pro
 * corretor revisar e aprovar no painel.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sb = supabaseAdmin();

  // Carrega empreendimento + FAQs em paralelo (mesmo padrão do reindex).
  const [empRes, faqsRes] = await Promise.all([
    sb.from("empreendimentos").select("*").eq("id", id).maybeSingle(),
    sb
      .from("empreendimento_faqs")
      .select("*")
      .eq("empreendimento_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (empRes.error) {
    return NextResponse.json({ ok: false, error: empRes.error.message }, { status: 500 });
  }
  if (!empRes.data) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const emp = empRes.data as Empreendimento;
  const faqs = (faqsRes.data ?? []) as Faq[];

  const rawCount = Array.isArray(emp.raw_knowledge) ? emp.raw_knowledge.length : 0;
  // Se a base é pobre (sem raw e sem diferenciais), a IA vai propor lixo
  // baseado só em campos estruturados. Melhor barrar explicitamente e
  // pedir pro corretor subir docs antes.
  if (rawCount === 0 && (emp.diferenciais?.length ?? 0) === 0 && !emp.descricao) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Base de conhecimento muito pobre. Suba pelo menos um memorial/book comercial antes de pedir sugestão de FAQ.",
      },
      { status: 422 },
    );
  }

  const out = await suggestFaqs(emp, faqs);
  if (!out.ok) {
    return NextResponse.json(
      { ok: false, stage: out.stage, error: out.error, raw: out.raw },
      { status: out.stage === "claude" ? 502 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    proposals: out.proposals,
    tokens: out.totalTokens,
  });
}
