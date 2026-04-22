import { NextResponse, type NextRequest } from "next/server";
import { reindexEmpreendimento } from "@/lib/empreendimentos";
import { requireAdminApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/empreendimentos/[id]/reindex
 *
 * Força reindex manual do RAG. Útil quando:
 *  - RAG ficou stale (ex.: FAQs aprovadas no bug antigo do fire-and-forget).
 *  - Corretor editou empreendimento direto no Supabase dashboard.
 *  - Suspeita de estado inconsistente depois de algum erro.
 *
 * O endpoint é idempotente — dropa tudo e recria; rodar várias vezes não
 * corrompe.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  try {
    const indexed = await reindexEmpreendimento(id);
    return NextResponse.json({ ok: true, indexed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reindex] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
