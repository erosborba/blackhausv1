import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "./session";
import type { SessionAgent } from "./session";

/**
 * Guards de autenticação/autorização para route handlers (API).
 *
 * Diferente de `guard.ts` (usado em server pages), aqui retornamos
 * `NextResponse` em caso de falha em vez de chamar `redirect()` — que
 * produz comportamento errado em fetch().
 *
 * Uso:
 *   const gate = await requireAdminApi();
 *   if (gate instanceof NextResponse) return gate;
 *   const { agent } = gate;
 */

type GateOk = { user: { id: string; email: string | null }; agent: SessionAgent };

export async function requireSessionApi(): Promise<GateOk | NextResponse> {
  const { user, agent } = await getSession();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!agent || !agent.active) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  return { user, agent };
}

export async function requireAdminApi(): Promise<GateOk | NextResponse> {
  const gate = await requireSessionApi();
  if (gate instanceof NextResponse) return gate;
  if (gate.agent.role !== "admin") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  return gate;
}
