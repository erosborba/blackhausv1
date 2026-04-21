import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  deleteUnidade,
  updateUnidade,
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

const patchSchema = z.object({
  andar: z.coerce.number().int().optional(),
  numero: z.string().trim().min(1).max(50).optional(),
  tipologia_ref: z.string().trim().max(100).nullable().optional(),
  preco: z.number().nonnegative().nullable().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * PATCH /api/unidades/[id]
 * Edição inline na aba Unidades — geralmente só `status` (avail→reserved
 * quando corretor encosta numa venda) ou `preco`.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const role = await getCurrentRole();
  if (!can(role, "empreendimentos.edit")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const ok = await updateUnidade(id, parsed.data);
  if (!ok) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const role = await getCurrentRole();
  if (!can(role, "empreendimentos.delete")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const ok = await deleteUnidade(id);
  if (!ok) return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
