import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { reindexEmpreendimento } from "@/lib/empreendimentos";
import { requireAdminApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bulkSchema = z.object({
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(3),
        answer: z.string().trim().min(3),
        source: z.enum(["manual", "ai_generated"]).default("manual"),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * POST /api/admin/empreendimentos/[id]/faqs/bulk
 *
 * Insere várias FAQs de uma vez e roda UM reindex awaited no fim. Criado
 * por causa da race condition do fluxo antigo: aprovar 8 sugestões
 * disparava 8 POSTs single, cada um com reindex fire-and-forget — reindexes
 * rodando em paralelo corrompiam o estado de `empreendimento_chunks` e a
 * Bia podia não achar FAQ aprovada há 3s porque o embedding ainda não
 * tinha sido inserido.
 *
 * Resposta só volta depois do reindex completar — UX custa ~3-5s mas o
 * estado do RAG fica garantido quando o usuário solta o botão.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const rows = parsed.data.faqs.map((f) => ({ empreendimento_id: id, ...f }));
  const { data, error } = await sb.from("empreendimento_faqs").insert(rows).select("*");
  if (error) {
    console.error("[faqs bulk] insert error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Reindex awaited — é o ponto do endpoint. Se falhar, retornamos ok=true
  // com `indexed: 0` pra caller saber que as FAQs foram salvas mas o RAG
  // não foi atualizado (raro; log já sai pelo reindex).
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[faqs bulk] reindex threw:", e);
  }

  return NextResponse.json({ ok: true, data, indexed });
}
