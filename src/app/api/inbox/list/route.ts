import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getCurrentAgent } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inbox/list
 *
 * Endpoint canônico do Phase 1 /inbox. Consome a RPC `inbox_items` que já
 * devolve score + handoff + bridge por lead, ordenados por urgency > score >
 * recência (ver migration 20260420000011).
 *
 * Filtros via querystring:
 *   q        busca livre por phone/push_name/full_name
 *   status   lista separada por vírgula (qualified,new,...) — filtra em JS
 *   urgency  alta|media|baixa — só leads com handoff_urgency match
 *   hasHandoff=1  só leads com handoff pendente (handoff_notified_at != null
 *                 sem bridge_active)
 *
 * Role gate (Phase 5):
 *   - admin: vê tudo (p_agent_id = null).
 *   - corretor: só vê leads com assigned_agent_id = seu agent.id.
 */
export async function GET(req: NextRequest) {
  const agent = await getCurrentAgent();
  const role = agent?.role ?? "admin";
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const statusCsv = sp.get("status");
  const urgency = sp.get("urgency");
  const hasHandoff = sp.get("hasHandoff");

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("inbox_items", {
    search_text: q && q.trim().length > 0 ? q.trim() : null,
    p_agent_id: role === "corretor" && agent ? agent.id : null,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as Array<{
    id: string;
    status: string;
    handoff_urgency: string | null;
    handoff_notified_at: string | null;
    handoff_resolved_at: string | null;
    bridge_active: boolean | null;
    [k: string]: unknown;
  }>;

  if (statusCsv) {
    const allowed = new Set(
      statusCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    rows = rows.filter((r) => allowed.has(r.status));
  }

  if (urgency && ["alta", "media", "baixa"].includes(urgency)) {
    rows = rows.filter((r) => r.handoff_urgency === urgency);
  }

  if (hasHandoff === "1") {
    rows = rows.filter(
      (r) =>
        r.handoff_notified_at !== null &&
        r.bridge_active !== true &&
        !r.handoff_resolved_at,
    );
  }

  return NextResponse.json({ ok: true, role, data: rows });
}
