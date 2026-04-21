import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  rescheduleVisit,
  updateVisitStatus,
  type VisitStatus,
} from "@/lib/visits";
import { getCurrentRole } from "@/lib/auth/role-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const VISIT_STATUS_VALUES: [VisitStatus, ...VisitStatus[]] = [
  "scheduled",
  "confirmed",
  "done",
  "cancelled",
  "no_show",
];

const patchSchema = z.union([
  z.object({
    status: z.enum(VISIT_STATUS_VALUES),
    notes: z.string().trim().max(1000).optional().nullable(),
    cancelled_reason: z.string().trim().max(500).optional().nullable(),
  }),
  z.object({
    scheduled_at: z.string().datetime(),
  }),
]);

/**
 * PATCH /api/visits/[id]
 * - status update: `{status, notes?, cancelled_reason?}`
 * - reschedule:    `{scheduled_at}` (volta pra 'scheduled')
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const role = await getCurrentRole();
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const actor = role === "admin" ? "gestor" : "corretor";

  if ("status" in parsed.data) {
    const ok = await updateVisitStatus(id, parsed.data.status, {
      notes: parsed.data.notes ?? undefined,
      cancelled_reason: parsed.data.cancelled_reason ?? undefined,
      actor,
    });
    if (!ok) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const ok = await rescheduleVisit(id, parsed.data.scheduled_at, actor);
  if (!ok) return NextResponse.json({ ok: false, error: "reschedule_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
