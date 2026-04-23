import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { runSDR } from "@/agent/graph";
import { clearCheckpointThread } from "@/lib/checkpointer";
import type { Lead } from "@/lib/leads";
import type { Qualification } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/eval/run-adhoc?token=...
 *
 * Endpoint efêmero pra rodar uma sequência de mensagens no grafo real
 * sem precisar seedar `eval_conversations`. Usado por scripts de
 * validação manual (ex: scripts/eval-tabela-precos.mjs).
 *
 * Body:
 *   {
 *     messages: string[],
 *     initial_lead?: {
 *       push_name?: string,
 *       stage?: string,
 *       memory?: string,
 *       qualification?: Qualification
 *     }
 *   }
 *
 * Token: BH_EVAL_TOKEN do env.
 *
 * Isola cada run em thread sintético (lead_id = eval-<uuid>) e limpa o
 * checkpoint antes. Não toca banco real de leads.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.BH_EVAL_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        messages?: string[];
        initial_lead?: {
          push_name?: string;
          stage?: string;
          memory?: string;
          qualification?: Qualification;
        };
      }
    | null;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { ok: false, error: "body: { messages: string[] } obrigatório" },
      { status: 400 },
    );
  }

  // UUID válido pra casar com o FK de `leads.id` (mesmo que a gente não
  // grave esse lead em banco, o checkpointer usa thread_id=lead:<id>).
  const syntheticId = randomUUID();
  const lead: Lead = {
    id: syntheticId,
    phone: `eval_${syntheticId.replace(/-/g, "").slice(0, 12)}`,
    push_name: body.initial_lead?.push_name ?? null,
    full_name: null,
    status: "eval",
    stage: (body.initial_lead?.stage as Lead["stage"]) ?? null,
    qualification: (body.initial_lead?.qualification ?? {}) as Qualification,
    human_takeover: false,
    agent_notes: null,
    memory: body.initial_lead?.memory ?? null,
    score: 0,
  };

  await clearCheckpointThread(`lead:${syntheticId}`);

  let lastResult: Awaited<ReturnType<typeof runSDR>> | null = null;
  for (const msg of body.messages) {
    lastResult = await runSDR({ lead, userText: msg });
  }
  if (!lastResult) {
    return NextResponse.json({ ok: false, error: "no_turns" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    reply: lastResult.reply,
    needsHandoff: lastResult.needsHandoff,
    handoffReason: lastResult.handoffReason,
    handoffUrgency: lastResult.handoffUrgency,
    stage: lastResult.stage,
    intent: lastResult.intent,
    qualification: lastResult.qualification,
    sources: lastResult.sources,
  });
}
