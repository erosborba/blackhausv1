import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { moveLeadStage, PIPELINE_STAGES } from "@/lib/pipeline";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  lead_id: z.string().uuid(),
  to_stage: z.enum(PIPELINE_STAGES as [string, ...string[]]),
});

/**
 * POST /api/pipeline/move
 * Corretor arrasta card no kanban → grava stage + emite event.
 * Retorna `{from, to}` pro client montar banner de undo.
 */
export async function POST(req: NextRequest) {
  const role = await getCurrentRole();
  if (!can(role, "pipeline.move_stage")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = await moveLeadStage(
    parsed.data.lead_id,
    parsed.data.to_stage,
    role === "admin" ? "gestor" : "corretor",
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: { from: result.from, to: result.to } });
}
