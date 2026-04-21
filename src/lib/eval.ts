/**
 * Eval harness — Track 1, Slice 1.1.
 *
 * Tipos e comparador do eval set. Runner real vive em `scripts/eval-run.mjs`
 * (via API `/api/eval/run` pra reaproveitar `runSDR()`).
 *
 * Princípio (VANGUARD.md I-4): toda mudança em src/agent/** roda por esse
 * comparador antes de merge. Sem eval verde, não mergea.
 *
 * Princípio (VANGUARD.md I-6): comparador é função pura — mesmo input,
 * mesmo output. LLM nunca decide se passou.
 */
import type { Lead, Qualification } from "./leads";
import type { HandoffReason, HandoffUrgency } from "./handoff-copy";
import type { Stage } from "@/agent/state";

// ── Tipos do banco ───────────────────────────────────────────────────────

export type EvalLeadMessage = {
  content: string;
  media_type?: "audio" | "image" | "video" | null;
};

/**
 * Estado inicial do lead sintético. Tudo opcional — o runner preenche
 * defaults razoáveis (phone começa com `5555`, `is_test=true` implícito).
 */
export type EvalInitialLead = Partial<
  Pick<
    Lead,
    | "full_name"
    | "push_name"
    | "stage"
    | "qualification"
    | "agent_notes"
    | "memory"
    | "score"
  >
>;

/**
 * O que esperamos no estado final depois que `runSDR()` processa todos os
 * turnos. Todos os campos são opcionais — só compara o que estiver setado.
 */
export type EvalExpected = {
  /** A Bia deve/não deve escalar. */
  needsHandoff?: boolean;
  /** Motivo do handoff (se needsHandoff=true). */
  handoffReason?: HandoffReason;
  /** Urgência esperada. */
  handoffUrgency?: HandoffUrgency;
  /** Stage final do pipeline. */
  stage?: Stage;
  /** Score mínimo esperado (inclusive). */
  scoreMin?: number;
  /** Score máximo esperado (inclusive). */
  scoreMax?: number;
  /** Chaves de `qualification` que devem estar preenchidas. */
  qualificationKeys?: Array<keyof Qualification>;
  /** Empreendimento que o retrieval deve citar (pelo menos 1 source match). */
  mustMentionEmpreendimentoId?: string;
  /** Substring que a última reply deve conter (case-insensitive). */
  replyMustContain?: string;
  /** Substring que a última reply NÃO deve conter (case-insensitive). */
  replyMustNotContain?: string;
  /**
   * Regex (source + opcionais flags) que a última reply NÃO pode casar.
   * Adicionado em Track 3 · 3.5b pra safety de cálculos financeiros —
   * substring não detecta "R$ 3.500", "parcela de 2.800", "3%", etc.
   * Formato: string pura (flags `i` implícito) OU `/pattern/flags`.
   * Ex: `"R\\$|\\bparcela\\b.*\\d"` ou `"/\\b\\d+%/i"`.
   */
  replyMustNotMatch?: string;
};

export type EvalConversationRow = {
  id: string;
  title: string;
  lead_messages: EvalLeadMessage[];
  initial_lead: EvalInitialLead;
  expected: EvalExpected;
  tags: string[];
  notes: string | null;
  created_at: string;
};

// ── Output da execução ───────────────────────────────────────────────────

/** Estado coletado após runSDR() — o que o comparador inspeciona. */
export type EvalActualState = {
  reply: string;
  needsHandoff: boolean;
  handoffReason: HandoffReason | null;
  handoffUrgency: HandoffUrgency | null;
  stage: Stage | null;
  score: number;
  qualification: Qualification;
  sources: Array<{ empreendimentoId?: string | null; kind?: string }>;
};

export type EvalComparison = {
  pass: boolean;
  checks: EvalCheck[];
};

export type EvalCheck = {
  dimension:
    | "needsHandoff"
    | "handoffReason"
    | "handoffUrgency"
    | "stage"
    | "scoreRange"
    | "qualificationKeys"
    | "mustMentionEmpreendimentoId"
    | "replyMustContain"
    | "replyMustNotContain"
    | "replyMustNotMatch";
  pass: boolean;
  expected: unknown;
  actual: unknown;
  detail?: string;
};

export type EvalCaseResult = {
  id: string;
  title: string;
  tags: string[];
  pass: boolean;
  checks: EvalCheck[];
  actual: EvalActualState;
  error?: string;
  durationMs: number;
};

export type EvalRunSummary = {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cases: EvalCaseResult[];
};

// ── Comparador (função pura) ─────────────────────────────────────────────

/**
 * Compara o estado real (output do graph) com o esperado. Pura — mesmo
 * input, mesmo output. LLM nunca é chamado aqui.
 */
export function compareExpected(
  expected: EvalExpected,
  actual: EvalActualState,
): EvalComparison {
  const checks: EvalCheck[] = [];

  // 1. needsHandoff (bool exato)
  if (expected.needsHandoff !== undefined) {
    checks.push({
      dimension: "needsHandoff",
      expected: expected.needsHandoff,
      actual: actual.needsHandoff,
      pass: actual.needsHandoff === expected.needsHandoff,
    });
  }

  // 2. handoffReason (string exato, só checa se esperado)
  if (expected.handoffReason !== undefined) {
    checks.push({
      dimension: "handoffReason",
      expected: expected.handoffReason,
      actual: actual.handoffReason,
      pass: actual.handoffReason === expected.handoffReason,
    });
  }

  // 3. handoffUrgency
  if (expected.handoffUrgency !== undefined) {
    checks.push({
      dimension: "handoffUrgency",
      expected: expected.handoffUrgency,
      actual: actual.handoffUrgency,
      pass: actual.handoffUrgency === expected.handoffUrgency,
    });
  }

  // 4. stage
  if (expected.stage !== undefined) {
    checks.push({
      dimension: "stage",
      expected: expected.stage,
      actual: actual.stage,
      pass: actual.stage === expected.stage,
    });
  }

  // 5. scoreRange
  if (expected.scoreMin !== undefined || expected.scoreMax !== undefined) {
    const min = expected.scoreMin ?? -Infinity;
    const max = expected.scoreMax ?? Infinity;
    const ok = actual.score >= min && actual.score <= max;
    checks.push({
      dimension: "scoreRange",
      expected: { min: expected.scoreMin, max: expected.scoreMax },
      actual: actual.score,
      pass: ok,
      detail: ok ? undefined : `score ${actual.score} fora de [${min},${max}]`,
    });
  }

  // 6. qualificationKeys — cada chave listada deve estar preenchida
  if (expected.qualificationKeys && expected.qualificationKeys.length > 0) {
    const missing: string[] = [];
    for (const k of expected.qualificationKeys) {
      const v = (actual.qualification as Record<string, unknown>)[k as string];
      const filled =
        v !== null &&
        v !== undefined &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0);
      if (!filled) missing.push(String(k));
    }
    checks.push({
      dimension: "qualificationKeys",
      expected: expected.qualificationKeys,
      actual: Object.keys(actual.qualification),
      pass: missing.length === 0,
      detail: missing.length === 0 ? undefined : `faltando: ${missing.join(", ")}`,
    });
  }

  // 7. mustMentionEmpreendimentoId — retrieval cita o empreendimento X
  if (expected.mustMentionEmpreendimentoId) {
    const ids = actual.sources
      .map((s) => s.empreendimentoId)
      .filter((x): x is string => Boolean(x));
    const cited = ids.includes(expected.mustMentionEmpreendimentoId);
    checks.push({
      dimension: "mustMentionEmpreendimentoId",
      expected: expected.mustMentionEmpreendimentoId,
      actual: ids,
      pass: cited,
      detail: cited ? undefined : "empreendimento esperado não apareceu em sources",
    });
  }

  // 8. replyMustContain
  if (expected.replyMustContain) {
    const needle = expected.replyMustContain.toLowerCase();
    const hay = actual.reply.toLowerCase();
    checks.push({
      dimension: "replyMustContain",
      expected: expected.replyMustContain,
      actual: actual.reply.slice(0, 200),
      pass: hay.includes(needle),
    });
  }

  // 9. replyMustNotContain
  if (expected.replyMustNotContain) {
    const needle = expected.replyMustNotContain.toLowerCase();
    const hay = actual.reply.toLowerCase();
    checks.push({
      dimension: "replyMustNotContain",
      expected: expected.replyMustNotContain,
      actual: actual.reply.slice(0, 200),
      pass: !hay.includes(needle),
    });
  }

  // 10. replyMustNotMatch (regex) — safety check pra cálculos financeiros.
  //
  // Aceita duas formas:
  //   "pattern"          → compilado como new RegExp(pattern, "i")
  //   "/pattern/flags"   → extrai pattern + flags (sempre força "i" no mínimo)
  //
  // Se o regex não compilar, o check falha com `detail` explicando — fail-loud
  // pra não silenciar typos no eval.
  if (expected.replyMustNotMatch) {
    const raw = expected.replyMustNotMatch;
    let re: RegExp | null = null;
    let compileError: string | null = null;
    try {
      const m = /^\/(.+)\/([gimsuy]*)$/.exec(raw);
      if (m) {
        const flags = m[2].includes("i") ? m[2] : m[2] + "i";
        re = new RegExp(m[1], flags);
      } else {
        re = new RegExp(raw, "i");
      }
    } catch (e) {
      compileError = e instanceof Error ? e.message : String(e);
    }
    const matched = re ? re.test(actual.reply) : false;
    checks.push({
      dimension: "replyMustNotMatch",
      expected: expected.replyMustNotMatch,
      actual: actual.reply.slice(0, 200),
      pass: re !== null && !matched,
      detail: compileError
        ? `regex inválido: ${compileError}`
        : matched
          ? `casou (reply tem ${re!.source})`
          : undefined,
    });
  }

  const pass = checks.length > 0 && checks.every((c) => c.pass);
  return { pass, checks };
}

// ── Helpers pro runner ───────────────────────────────────────────────────

/**
 * Monta um lead sintético a partir do `initial_lead` da eval.
 *
 * IMPORTANTE: `id` é o próprio `conv.id` (UUID gerado por gen_random_uuid
 * em eval_conversations). Postgres não aceita strings arbitrárias em
 * colunas uuid — tentar `eval-<xxx>` quebraria `recentMessages` e
 * afins. Usar o UUID real não colide com leads reais porque:
 *   (a) random UUIDs têm entropia suficiente
 *   (b) o phone prefixo `eval_` marca explicitamente que é sintético
 *
 * Phone prefixo `eval_` em vez de `5555` porque `phone` é unique no
 * banco e `5555*` já pode estar sendo usado por testes manuais. Não
 * rodamos outbound real neste lead, então não precisa de formato
 * telefônico válido.
 */
export function buildSyntheticLead(
  conv: Pick<EvalConversationRow, "id" | "initial_lead">,
): Lead {
  const init = conv.initial_lead ?? {};
  return {
    id: conv.id,
    phone: `eval_${conv.id.replace(/-/g, "").slice(0, 12)}`,
    push_name: init.push_name ?? null,
    full_name: init.full_name ?? null,
    status: "eval",
    stage: init.stage ?? null,
    qualification: (init.qualification ?? {}) as Qualification,
    human_takeover: false,
    agent_notes: init.agent_notes ?? null,
    memory: init.memory ?? null,
    score: init.score ?? 0,
  };
}
