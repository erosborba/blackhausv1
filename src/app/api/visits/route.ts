import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createVisit, dayBoundsBR, listVisitsBetween } from "@/lib/visits";
import { getCurrentRole } from "@/lib/auth/role-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/visits?from=ISO&to=ISO
 * Lista visitas num intervalo (default = hoje BR).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");

  let from: Date;
  let to: Date;
  if (fromRaw && toRaw) {
    from = new Date(fromRaw);
    to = new Date(toRaw);
  } else {
    const bounds = dayBoundsBR(new Date());
    from = bounds.from;
    to = bounds.to;
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ ok: false, error: "invalid_dates" }, { status: 400 });
  }

  const visits = await listVisitsBetween(from, to);
  return NextResponse.json({ ok: true, data: { visits } });
}

const createSchema = z.object({
  lead_id: z.string().uuid(),
  empreendimento_id: z.string().uuid().nullable().optional(),
  unidade_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  scheduled_at: z.string().datetime(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * POST /api/visits
 * Cria nova visita. Corretor agenda direto pelo /inbox ou /agenda.
 */
export async function POST(req: NextRequest) {
  const role = await getCurrentRole();
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const visit = await createVisit({
    ...parsed.data,
    created_by: role === "admin" ? "gestor" : "corretor",
  });
  if (!visit) {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: { visit } });
}
