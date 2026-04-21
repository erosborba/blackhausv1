import { NextResponse, type NextRequest } from "next/server";
import {
  listAgentsWithAvailability,
  createAvailabilityWindow,
  deactivateAvailabilityWindow,
} from "@/lib/agent-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/agent-availability — Track 2 · Slice 2.9.
 *
 *   GET    → lista agentes + janelas
 *   POST   → cria janela { agent_id, weekday, start_minute, end_minute, timezone? }
 *   DELETE → desativa janela (?id=...)
 *
 * Sem auth adicional aqui — o gate acontece na UI (/ajustes tem
 * role-check). Na Phase 5 quando tivermos Supabase Auth real, fica
 * trivial plugar middleware.
 */

export async function GET() {
  try {
    const data = await listAgentsWithAvailability();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    agent_id?: string;
    weekday?: number;
    start_minute?: number;
    end_minute?: number;
    timezone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (
    !body.agent_id ||
    typeof body.weekday !== "number" ||
    typeof body.start_minute !== "number" ||
    typeof body.end_minute !== "number"
  ) {
    return NextResponse.json(
      { ok: false, error: "agent_id, weekday, start_minute e end_minute obrigatórios" },
      { status: 400 },
    );
  }

  const result = await createAvailabilityWindow({
    agent_id: body.agent_id,
    weekday: body.weekday,
    start_minute: body.start_minute,
    end_minute: body.end_minute,
    timezone: body.timezone,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id obrigatório" }, { status: 400 });
  }
  const result = await deactivateAvailabilityWindow(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
