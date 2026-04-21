import { NextResponse, type NextRequest } from "next/server";
import {
  listUnavailability,
  createUnavailability,
  deactivateUnavailability,
} from "@/lib/agent-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/agent-unavailability — Track 2 · Slice 2.3'.
 *
 *   GET    ?agent_id=...  (opcional) — lista bloqueios futuros/em curso
 *   POST   { agent_id, start_at, end_at, reason?, created_by? } — cria
 *   DELETE ?id=...                   — soft-delete (active=false)
 *
 * Auth: segue o padrão de `/api/admin/agent-availability` — gate na UI.
 */

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agent_id") ?? undefined;
  try {
    const data = await listUnavailability(agentId);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: {
    agent_id?: string;
    start_at?: string;
    end_at?: string;
    reason?: string | null;
    created_by?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (!body.agent_id || !body.start_at || !body.end_at) {
    return NextResponse.json(
      { ok: false, error: "agent_id, start_at e end_at obrigatórios" },
      { status: 400 },
    );
  }

  const result = await createUnavailability({
    agent_id: body.agent_id,
    start_at: body.start_at,
    end_at: body.end_at,
    reason: body.reason ?? null,
    created_by: body.created_by ?? "admin",
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
  const result = await deactivateUnavailability(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
