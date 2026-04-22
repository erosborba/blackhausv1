/**
 * Vanguard · Track 3 · Slice 3.6b — listagem de sugestões pending.
 *
 * GET /api/suggestions?lead_id=<uuid> → sugestões pending do lead.
 *
 * Usado pelo SuggestionsCard no ContextRail pra carga inicial antes
 * do realtime começar a entregar INSERTs. Também é fallback se o canal
 * desconectar — o hook pode chamar `refetch()`.
 *
 * Precisa de sessão (corretor logado) — mesma ACL do resto do /inbox.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { listPendingSuggestionsByLead } from "@/lib/copilot-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  lead_id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const { agent } = await getSession();
  if (!agent) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ lead_id: url.searchParams.get("lead_id") });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const rows = await listPendingSuggestionsByLead(parsed.data.lead_id);
  return NextResponse.json({ ok: true, data: rows });
}
