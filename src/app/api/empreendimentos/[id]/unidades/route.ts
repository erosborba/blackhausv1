import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createUnidade,
  listUnidades,
  type UnidadeStatus,
} from "@/lib/unidades";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATUS_VALUES: [UnidadeStatus, ...UnidadeStatus[]] = [
  "avail",
  "reserved",
  "sold",
  "unavailable",
];

/**
 * GET /api/empreendimentos/[id]/unidades
 * Lista raw (não agrupada) — tabela de admin na aba Unidades.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const unidades = await listUnidades(id);
  return NextResponse.json({ ok: true, data: { unidades } });
}

const createSchema = z.object({
  andar: z.coerce.number().int(),
  numero: z.string().trim().min(1).max(50),
  tipologia_ref: z.string().trim().max(100).optional().nullable(),
  preco: z.number().nonnegative().optional().nullable(),
  status: z.enum(STATUS_VALUES).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * POST /api/empreendimentos/[id]/unidades
 * Cria nova unidade no empreendimento. Só admin.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const role = await getCurrentRole();
  if (!can(role, "empreendimentos.edit")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const unidade = await createUnidade({
    empreendimento_id: id,
    ...parsed.data,
  });
  if (!unidade) {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: { unidade } });
}
