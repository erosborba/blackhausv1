import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getCurrentRole } from "@/lib/auth/role-server";
import {
  buildSyntheticLead,
  compareExpected,
  type EvalActualState,
  type EvalCaseResult,
  type EvalConversationRow,
  type EvalRunSummary,
} from "@/lib/eval";
import { runSDR } from "@/agent/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Eval pode demorar por conta das chamadas de LLM.
export const maxDuration = 300;

/**
 * POST /api/eval/run
 *
 * Roda todos os casos de `eval_conversations` (ou um subset filtrado) e
 * retorna `EvalRunSummary`. Pura infra: não grava nada no banco além das
 * side-effects do `runSDR` (checkpointer com thread_id `lead:eval-<uuid>`,
 * namespaced longe de leads reais).
 *
 * Guardado por role admin. CLI (`scripts/eval-run.mjs`) bate aqui com
 * `Authorization: Bearer <SERVICE_ROLE>` equivalente via cookie de dev OU
 * via query `?token=<SERVICE_ROLE_SECRET>` (futuro slice 1.3).
 *
 * Body opcional: `{ ids?: string[], tags?: string[], limit?: number }`
 */
export async function POST(req: NextRequest) {
  // Gate: admin em dev; em prod idealmente token-based (slice 1.3 endurece).
  const role = await getCurrentRole();
  const token = req.nextUrl.searchParams.get("token");
  const serviceToken = process.env.BH_EVAL_TOKEN;
  const tokenOk =
    serviceToken && token && token === serviceToken ? true : false;
  if (!tokenOk && role !== "admin") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body?.ids) ? body.ids : undefined;
  const tags: string[] | undefined = Array.isArray(body?.tags) ? body.tags : undefined;
  const limit: number = typeof body?.limit === "number" ? body.limit : 100;

  const sb = supabaseAdmin();
  let q = sb
    .from("eval_conversations")
    .select("id, title, lead_messages, initial_lead, expected, tags, notes, created_at")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (ids && ids.length > 0) q = q.in("id", ids);
  if (tags && tags.length > 0) q = q.overlaps("tags", tags);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const conversations = (data ?? []) as EvalConversationRow[];
  const startedAtIso = new Date().toISOString();
  const startedAt = Date.now();

  const cases: EvalCaseResult[] = [];
  for (const conv of conversations) {
    const caseStart = Date.now();
    try {
      const lead = buildSyntheticLead(conv);
      const turns = conv.lead_messages ?? [];

      let lastResult: Awaited<ReturnType<typeof runSDR>> | null = null;
      for (const turn of turns) {
        lastResult = await runSDR({ lead, userText: turn.content });
      }

      if (!lastResult) {
        cases.push({
          id: conv.id,
          title: conv.title,
          tags: conv.tags ?? [],
          pass: false,
          checks: [],
          actual: emptyActual(),
          error: "sem_turnos",
          durationMs: Date.now() - caseStart,
        });
        continue;
      }

      const actual: EvalActualState = {
        reply: lastResult.reply,
        needsHandoff: lastResult.needsHandoff,
        handoffReason: lastResult.handoffReason,
        handoffUrgency: lastResult.handoffUrgency,
        stage: lastResult.stage,
        score: lastResult.score,
        qualification: lastResult.qualification,
        sources: (lastResult.sources ?? []).map((s) => ({
          empreendimentoId:
            (s as { empreendimentoId?: string | null }).empreendimentoId ?? null,
          kind: (s as { kind?: string }).kind,
        })),
      };

      const cmp = compareExpected(conv.expected ?? {}, actual);
      cases.push({
        id: conv.id,
        title: conv.title,
        tags: conv.tags ?? [],
        pass: cmp.pass,
        checks: cmp.checks,
        actual,
        durationMs: Date.now() - caseStart,
      });
    } catch (e) {
      // Serialização robusta: Supabase/pg jogam objetos com `.message` mas
      // sem `instanceof Error`; outros erros tem `.cause` aninhado.
      const errStr = serializeError(e);
      // Log server-side pra stack completo (o cliente só vê a string).
      console.error(`[eval] case ${conv.title} failed:`, e);
      cases.push({
        id: conv.id,
        title: conv.title,
        tags: conv.tags ?? [],
        pass: false,
        checks: [],
        actual: emptyActual(),
        error: errStr,
        durationMs: Date.now() - caseStart,
      });
    }
  }

  const finishedAt = Date.now();
  const summary: EvalRunSummary = {
    total: cases.length,
    passed: cases.filter((c) => c.pass).length,
    failed: cases.filter((c) => !c.pass && !c.error).length,
    errored: cases.filter((c) => Boolean(c.error)).length,
    startedAt: startedAtIso,
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    cases,
  };

  return NextResponse.json({ ok: true, summary });
}

function serializeError(e: unknown): string {
  if (!e) return "unknown_error";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const parts: string[] = [e.message || e.name || "Error"];
    if ((e as { code?: string }).code) parts.push(`code=${(e as { code?: string }).code}`);
    if ((e as { cause?: unknown }).cause) {
      parts.push(`cause=${serializeError((e as { cause?: unknown }).cause)}`);
    }
    return parts.join(" · ");
  }
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    // Supabase error: { message, details, hint, code }
    if (typeof o.message === "string") {
      const extras = [o.code, o.details, o.hint]
        .filter((x) => typeof x === "string" && x)
        .join(" · ");
      return extras ? `${o.message} · ${extras}` : String(o.message);
    }
    try {
      return JSON.stringify(o).slice(0, 400);
    } catch {
      return String(o);
    }
  }
  return String(e);
}

function emptyActual(): EvalActualState {
  return {
    reply: "",
    needsHandoff: false,
    handoffReason: null,
    handoffUrgency: null,
    stage: null,
    score: 0,
    qualification: {},
    sources: [],
  };
}
