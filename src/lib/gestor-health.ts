import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { supabaseAdmin } from "./supabase";

/**
 * Health dashboard — Track 1 · Slice 1.6.
 *
 * As 3 métricas do guard-rail G-3 do VANGUARD (olho mágico contra drift):
 *   (a) Taxa de handoff (proxy "Bia desistiu")
 *   (b) Taxa de resposta do lead ao primeiro turno (proxy "Bia não engajou")
 *   (c) Custo/lead (proxy "prompt ficou verboso")
 *   (d) Eval pass rate histórico (lido de evals/history.jsonl, se existir)
 *
 * Cada métrica compara janela atual (7d) vs janela anterior (7d prévios
 * = dias 8-14 atrás). Degradação > 20% vira flag vermelho.
 *
 * Invariants: I-3 (custo observável), G-3 (dashboard anti-drift).
 */

export type HealthMetric = {
  key: "handoff_rate" | "response_rate" | "cost_per_lead" | "eval_pass_rate";
  label: string;
  current: number | null;
  previous: number | null;
  unit: "pct" | "brl" | "count";
  /** Mudança percentual vs janela anterior (negativa = piora pra handoff_rate/cost; positiva = piora pra response/eval). */
  deltaPct: number | null;
  /** "degraded" se piorou > 20%. */
  status: "ok" | "warn" | "degraded" | "no_data";
  hint?: string;
};

export type HealthSummary = {
  windowDays: number;
  metrics: HealthMetric[];
  generatedAt: string;
};

const WINDOW_DAYS = 7;
const DEGRADATION_THRESHOLD = 0.2; // 20% piora vermelho (G-3)

export async function loadHealth(): Promise<HealthSummary> {
  const sb = supabaseAdmin();
  const now = Date.now();
  const d = 24 * 60 * 60 * 1000;
  const currentFrom = new Date(now - WINDOW_DAYS * d).toISOString();
  const previousFrom = new Date(now - 2 * WINDOW_DAYS * d).toISOString();
  const previousTo = currentFrom;

  // 1. Handoff rate = handoffs iniciados / leads novos na janela.
  const [leadsCur, leadsPrev, handoffCur, handoffPrev] = await Promise.all([
    countLeads(sb, currentFrom, null),
    countLeads(sb, previousFrom, previousTo),
    countHandoffEvents(sb, currentFrom, null),
    countHandoffEvents(sb, previousFrom, previousTo),
  ]);

  const handoffCur_rate = rate(handoffCur, leadsCur);
  const handoffPrev_rate = rate(handoffPrev, leadsPrev);

  // 2. Response rate — lead respondeu DEPOIS da primeira outbound da Bia.
  //    Aproximação: pra cada lead novo, existe inbound após created_at + 1min?
  const [responseCur, responsePrev] = await Promise.all([
    computeResponseRate(sb, currentFrom, null),
    computeResponseRate(sb, previousFrom, previousTo),
  ]);

  // 3. Cost per lead atendido.
  const [costCur, costPrev] = await Promise.all([
    sumCost(sb, currentFrom, null),
    sumCost(sb, previousFrom, previousTo),
  ]);
  const costPerLeadCur = leadsCur > 0 ? costCur / leadsCur : null;
  const costPerLeadPrev = leadsPrev > 0 ? costPrev / leadsPrev : null;

  // 4. Eval pass rate — histórico em evals/history.jsonl (slice 1.3 grava).
  const evalHistory = readEvalHistory();
  const evalCur = evalHistory.at(-1)?.passRate ?? null;
  const evalPrev = evalHistory.at(-2)?.passRate ?? null;

  const metrics: HealthMetric[] = [
    buildMetric({
      key: "handoff_rate",
      label: "Taxa de handoff",
      current: handoffCur_rate,
      previous: handoffPrev_rate,
      unit: "pct",
      // Pra handoff, SUBIR é piorar (Bia desistindo mais).
      worseWhenHigher: true,
      hint: `${handoffCur} handoffs / ${leadsCur} leads`,
    }),
    buildMetric({
      key: "response_rate",
      label: "Taxa de resposta (lead → Bia)",
      current: responseCur,
      previous: responsePrev,
      unit: "pct",
      worseWhenHigher: false,
      hint: `janela ${WINDOW_DAYS}d`,
    }),
    buildMetric({
      key: "cost_per_lead",
      label: "Custo por lead",
      current: costPerLeadCur !== null ? costPerLeadCur * 5 : null, // aproxima USD→BRL ~R$5
      previous: costPerLeadPrev !== null ? costPerLeadPrev * 5 : null,
      unit: "brl",
      worseWhenHigher: true,
      hint: `total USD ${costCur.toFixed(2)}`,
    }),
    buildMetric({
      key: "eval_pass_rate",
      label: "Eval pass rate",
      current: evalCur,
      previous: evalPrev,
      unit: "pct",
      worseWhenHigher: false,
      hint:
        evalHistory.length > 0
          ? `${evalHistory.length} runs históricos`
          : "ainda sem histórico — rode npm run eval",
    }),
  ];

  return {
    windowDays: WINDOW_DAYS,
    metrics,
    generatedAt: new Date().toISOString(),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

async function countLeads(
  sb: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string | null,
): Promise<number> {
  let q = sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", from)
    .not("phone", "like", "5555%")
    .not("phone", "like", "eval\\_%");
  if (to) q = q.lt("created_at", to);
  const { count } = await q;
  return count ?? 0;
}

async function countHandoffEvents(
  sb: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string | null,
): Promise<number> {
  let q = sb
    .from("lead_events")
    .select("id", { count: "exact", head: true })
    .eq("kind", "handoff_requested")
    .gte("at", from);
  if (to) q = q.lt("at", to);
  const { count } = await q;
  return count ?? 0;
}

async function computeResponseRate(
  sb: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string | null,
): Promise<number | null> {
  // Leads novos na janela.
  let leadsQ = sb
    .from("leads")
    .select("id, created_at")
    .gte("created_at", from)
    .not("phone", "like", "5555%")
    .limit(1000);
  if (to) leadsQ = leadsQ.lt("created_at", to);
  const { data: leadsRows, error: leadsErr } = await leadsQ;
  if (leadsErr || !leadsRows || leadsRows.length === 0) return null;

  const leadIds = leadsRows.map((l) => l.id);
  // Mensagens dos leads na janela. Queremos pelo menos 1 inbound APÓS a primeira outbound.
  const { data: msgs, error: msgErr } = await sb
    .from("messages")
    .select("lead_id, direction, created_at")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: true });
  if (msgErr || !msgs) return null;

  const seen = new Map<string, { firstOut: string | null; respondedAfter: boolean }>();
  for (const m of msgs) {
    const entry = seen.get(m.lead_id) ?? {
      firstOut: null as string | null,
      respondedAfter: false,
    };
    if (m.direction === "outbound" && !entry.firstOut) {
      entry.firstOut = m.created_at as string;
    } else if (
      m.direction === "inbound" &&
      entry.firstOut &&
      (m.created_at as string) > entry.firstOut
    ) {
      entry.respondedAfter = true;
    }
    seen.set(m.lead_id, entry);
  }

  const leadsWithOut = [...seen.values()].filter((v) => v.firstOut);
  if (leadsWithOut.length === 0) return null;
  const responded = leadsWithOut.filter((v) => v.respondedAfter).length;
  return responded / leadsWithOut.length;
}

async function sumCost(
  sb: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string | null,
): Promise<number> {
  let q = sb
    .from("ai_usage_log")
    .select("cost_usd")
    .gte("created_at", from)
    .limit(50000);
  if (to) q = q.lt("created_at", to);
  const { data, error } = await q;
  if (error || !data) return 0;
  return data.reduce(
    (acc, r) => acc + Number((r as { cost_usd?: number | string }).cost_usd ?? 0),
    0,
  );
}

function readEvalHistory(): Array<{ at: string; passRate: number }> {
  try {
    const path = resolve(process.cwd(), "evals/history.jsonl");
    if (!existsSync(path)) return [];
    const text = readFileSync(path, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          const o = JSON.parse(line);
          const pass = Number(o.passed ?? 0);
          const total = Number(o.total ?? 0);
          return {
            at: String(o.at ?? ""),
            passRate: total > 0 ? pass / total : 0,
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is { at: string; passRate: number } => Boolean(x))
      .slice(-30);
  } catch {
    return [];
  }
}

function rate(num: number, den: number): number | null {
  if (den === 0) return null;
  return num / den;
}

function buildMetric(args: {
  key: HealthMetric["key"];
  label: string;
  current: number | null;
  previous: number | null;
  unit: HealthMetric["unit"];
  worseWhenHigher: boolean;
  hint?: string;
}): HealthMetric {
  const { current, previous, worseWhenHigher } = args;
  let deltaPct: number | null = null;
  let status: HealthMetric["status"] = "ok";

  if (current === null || previous === null) {
    status = "no_data";
  } else if (previous === 0) {
    // Evita divisão por zero: se era zero e agora tem algo, flag warn.
    deltaPct = current > 0 ? 1 : 0;
    status = current > 0 && worseWhenHigher ? "warn" : "ok";
  } else {
    deltaPct = (current - previous) / previous;
    const piorou = worseWhenHigher ? deltaPct > 0 : deltaPct < 0;
    const magnitude = Math.abs(deltaPct);
    if (piorou && magnitude > DEGRADATION_THRESHOLD) status = "degraded";
    else if (piorou && magnitude > DEGRADATION_THRESHOLD / 2) status = "warn";
    else status = "ok";
  }

  return {
    key: args.key,
    label: args.label,
    current: args.current,
    previous: args.previous,
    unit: args.unit,
    deltaPct,
    status,
    hint: args.hint,
  };
}

export function formatMetric(value: number | null, unit: HealthMetric["unit"]): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "pct") return `${(value * 100).toFixed(1)}%`;
  if (unit === "brl") return `R$ ${value.toFixed(2)}`;
  return value.toLocaleString("pt-BR");
}

export function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null) return "—";
  const sign = deltaPct >= 0 ? "+" : "";
  return `${sign}${(deltaPct * 100).toFixed(1)}%`;
}
