import { NextResponse, type NextRequest } from "next/server";
import {
  getUnidadesMatrix,
  getUnidadesSummary,
  listAvailableUnidades,
} from "@/lib/unidades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/empreendimentos/[id]/availability
 *
 * Payload pra aba "Unidades" do /empreendimentos/[id]:
 *   - summary (contagens por status + preço min/max)
 *   - matrix (por andar)
 *   - available (flat, ordenada por preço — útil pra agente e pra filtro)
 *
 * ?tipologia=2q-suite filtra a lista `available`.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const tipologia = searchParams.get("tipologia");

  const [summary, matrix, available] = await Promise.all([
    getUnidadesSummary(id),
    getUnidadesMatrix(id),
    listAvailableUnidades(id, tipologia ?? undefined),
  ]);

  return NextResponse.json({
    ok: true,
    data: { summary, matrix, available },
  });
}
