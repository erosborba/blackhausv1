import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai-usage?days=7
 *
 * Retorna agregações pra o dashboard /admin/usage:
 *   - totais no período (USD, tokens, chamadas)
 *   - quebra por task
 *   - quebra por model
 *   - série diária
 *   - últimas 20 linhas (drill-down pra casos esquisitos)
 *
 * Default `days=7`. Cap em 90 pra não varrer a tabela inteira acidentalmente.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const daysRaw = Number(sp.get("days") ?? "7");
  const days = Math.max(1, Math.min(90, Number.isFinite(daysRaw) ? daysRaw : 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const sb = supabaseAdmin();
  // Busca tudo no período. A tabela tem índice em created_at desc + o volume
  // esperado é baixo (milhares de linhas/dia, não milhões). Agregamos em JS
  // pra não depender de RPC/view — simples e rápido o bastante pro dashboard.
  const { data, error } = await sb
    .from("ai_usage_log")
    .select(
      "created_at, provider, model, task, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, ok, empreendimento_id, lead_id",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];

  // Totais gerais
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCalls = 0;
  let totalErrors = 0;

  // Buckets
  const byTask = new Map<string, { cost: number; calls: number; input: number; output: number }>();
  const byModel = new Map<string, { cost: number; calls: number }>();
  const byDay = new Map<string, { cost: number; calls: number }>();

  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0;
    totalCost += cost;
    totalInput += r.input_tokens || 0;
    totalOutput += r.output_tokens || 0;
    totalCacheRead += r.cache_read_tokens || 0;
    totalCacheWrite += r.cache_write_tokens || 0;
    totalCalls += 1;
    if (!r.ok) totalErrors += 1;

    const t = byTask.get(r.task) ?? { cost: 0, calls: 0, input: 0, output: 0 };
    t.cost += cost;
    t.calls += 1;
    t.input += r.input_tokens || 0;
    t.output += r.output_tokens || 0;
    byTask.set(r.task, t);

    const m = byModel.get(r.model) ?? { cost: 0, calls: 0 };
    m.cost += cost;
    m.calls += 1;
    byModel.set(r.model, m);

    const day = (r.created_at as string).slice(0, 10); // YYYY-MM-DD
    const d = byDay.get(day) ?? { cost: 0, calls: 0 };
    d.cost += cost;
    d.calls += 1;
    byDay.set(day, d);
  }

  const toTask = Array.from(byTask.entries())
    .map(([task, v]) => ({ task, ...v, cost: round6(v.cost) }))
    .sort((a, b) => b.cost - a.cost);

  const toModel = Array.from(byModel.entries())
    .map(([model, v]) => ({ model, ...v, cost: round6(v.cost) }))
    .sort((a, b) => b.cost - a.cost);

  const toDay = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, ...v, cost: round6(v.cost) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const recent = rows.slice(0, 20).map((r) => ({
    created_at: r.created_at,
    provider: r.provider,
    model: r.model,
    task: r.task,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_read_tokens: r.cache_read_tokens,
    cache_write_tokens: r.cache_write_tokens,
    cost_usd: round6(Number(r.cost_usd) || 0),
    duration_ms: r.duration_ms,
    ok: r.ok,
    empreendimento_id: r.empreendimento_id,
    lead_id: r.lead_id,
  }));

  return NextResponse.json({
    ok: true,
    window: { days, since },
    totals: {
      cost_usd: round6(totalCost),
      calls: totalCalls,
      errors: totalErrors,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_tokens: totalCacheRead,
      cache_write_tokens: totalCacheWrite,
    },
    by_task: toTask,
    by_model: toModel,
    by_day: toDay,
    recent,
  });
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
