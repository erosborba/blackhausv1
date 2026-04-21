#!/usr/bin/env node
/**
 * Runner do eval set — Track 1, Slices 1.1 + 1.3.
 *
 *   node scripts/eval-run.mjs                    # roda tudo
 *   node scripts/eval-run.mjs --tag=handoff      # filtra por tag
 *   node scripts/eval-run.mjs --ids=uuid1,uuid2
 *   node scripts/eval-run.mjs --limit=5
 *   node scripts/eval-run.mjs --verbose          # imprime cada check
 *   node scripts/eval-run.mjs --update-baseline  # escreve evals/baseline.json (só em runs locais verdes)
 *   node scripts/eval-run.mjs --update-baseline --force  # aceita baseline com fails (ex.: flaky conhecido)
 *   node scripts/eval-run.mjs --gate=ci          # compara vs baseline e falha se regressão > 10%
 *
 * Chama `POST <APP_BASE_URL>/api/eval/run` — o app precisa estar rodando
 * (`npm run dev`). Usa BH_EVAL_TOKEN do .env.local pra autenticar sem
 * sessão de cookies.
 *
 * Exit code:
 *   0 — todos passaram (ou 0 casos), ou gate=ci dentro do threshold
 *   1 — pelo menos 1 caso falhou (sem gate) OU regressão > 10% (gate=ci)
 *   2 — erro de infra (endpoint não respondeu, etc.)
 *
 * Invariants: I-4 (evaluation-first), I-6 (comparador é puro). G-1 (CI gate).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const root = process.cwd();
const env = {
  ...loadEnvFile(resolve(root, ".env")),
  ...loadEnvFile(resolve(root, ".env.local")),
  ...process.env,
};

const args = process.argv.slice(2);
function argVal(name, fallback) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const verbose = args.includes("--verbose");
const updateBaseline = args.includes("--update-baseline");
const force = args.includes("--force");
const gate = argVal("gate"); // "ci" | undefined
const tag = argVal("tag");
const idsArg = argVal("ids");
const limit = Number(argVal("limit", "100"));
const BASELINE_PATH = resolve(root, "evals/baseline.json");
const REGRESSION_THRESHOLD = 0.1; // > 10% de regressão quebra CI (G-1)

const BASE = (env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = env.BH_EVAL_TOKEN;

if (!TOKEN) {
  console.error(
    "[eval] BH_EVAL_TOKEN não definido em .env.local — setando um valor qualquer destrava o gate em /api/eval/run.",
  );
  process.exit(2);
}

const body = {
  limit,
  ...(idsArg ? { ids: idsArg.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
  ...(tag ? { tags: tag.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
};

const url = `${BASE}/api/eval/run?token=${encodeURIComponent(TOKEN)}`;

console.log(`[eval] POST ${url.replace(TOKEN, "***")}`);
console.log(`[eval] body:`, body);

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
} catch (e) {
  console.error(`[eval] fetch falhou: ${e?.message || e}`);
  console.error(`[eval] o servidor Next.js está rodando em ${BASE}?`);
  process.exit(2);
}

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error(`[eval] resposta não-JSON (status ${res.status}):`, text.slice(0, 500));
  process.exit(2);
}

if (!res.ok || !data.ok) {
  console.error(`[eval] endpoint retornou erro (status ${res.status}):`, data);
  process.exit(2);
}

const summary = data.summary;
printSummary(summary, { verbose });

// ── Histórico pro dashboard /gestor/health (slice 1.6) ───────────────────
try {
  const historyPath = resolve(root, "evals/history.jsonl");
  const line = JSON.stringify({
    at: new Date().toISOString(),
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    errored: summary.errored,
    durationMs: summary.durationMs,
    commit: tryGitHead(),
  });
  appendFileSync(historyPath, line + "\n", "utf8");
} catch (e) {
  console.warn(`[eval] não consegui escrever history.jsonl: ${e?.message || e}`);
}

// ── Baseline update (local, após run verde) ──────────────────────────────
if (updateBaseline) {
  if ((summary.failed > 0 || summary.errored > 0) && !force) {
    console.error("[eval] --update-baseline recusado: run com falhas/erros. Corrija antes ou passe --force (pra flaky conhecido).");
    process.exit(1);
  }
  if ((summary.failed > 0 || summary.errored > 0) && force) {
    console.warn(`[eval] --force: aceitando baseline com ${summary.failed} fail + ${summary.errored} errored (flaky conhecido).`);
  }
  const baseline = {
    version: 1,
    description: "Baseline do eval set — último run verde. Gerado por --update-baseline.",
    updated_at: new Date().toISOString(),
    commit: tryGitHead(),
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    errored: summary.errored,
    case_results: Object.fromEntries(
      summary.cases.map((c) => [c.id, { title: c.title, pass: c.pass, tags: c.tags }]),
    ),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  console.log(`[eval] baseline atualizado: ${BASELINE_PATH}`);
  console.log(`[eval] commit: ${baseline.commit ?? "(sem git)"}`);
  process.exit(0);
}

// ── Gate de CI (slice 1.3) ───────────────────────────────────────────────
if (gate === "ci") {
  if (!existsSync(BASELINE_PATH)) {
    console.log("[eval] sem baseline commitado — CI gate pula (primeira execução).");
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  // Baseline vazio (total=0) = primeira vez que CI roda; não bloqueia.
  if (!baseline.total || baseline.total === 0) {
    console.log("[eval] baseline vazio — CI gate pula. Rode `npm run eval -- --update-baseline` localmente pra criar.");
    process.exit(0);
  }
  const baselinePassed = baseline.passed ?? 0;
  const regression = baselinePassed > 0 ? (baselinePassed - summary.passed) / baselinePassed : 0;
  console.log("");
  console.log(`[eval] CI gate · baseline ${baselinePassed}/${baseline.total} · atual ${summary.passed}/${summary.total}`);
  console.log(`[eval] regressão: ${(regression * 100).toFixed(1)}% (threshold ${(REGRESSION_THRESHOLD * 100).toFixed(0)}%)`);
  if (regression > REGRESSION_THRESHOLD) {
    // Detalha quais casos regrediram (passavam no baseline, falham agora).
    const wasPassing = new Set(
      Object.entries(baseline.case_results || {})
        .filter(([, v]) => v.pass)
        .map(([id]) => id),
    );
    const regressed = summary.cases.filter((c) => !c.pass && wasPassing.has(c.id));
    console.error(`[eval] ✗ regressão acima do threshold (${regressed.length} casos caíram):`);
    for (const c of regressed) {
      console.error(`       - ${c.title}`);
    }
    process.exit(1);
  }
  console.log("[eval] ✓ dentro do threshold");
  process.exit(0);
}

// Exit code default: 1 se alguém falhou ou errored, 0 caso contrário.
const hasFail = summary.failed > 0 || summary.errored > 0;
process.exit(hasFail ? 1 : 0);

function tryGitHead() {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function printSummary(s, { verbose }) {
  console.log("");
  console.log("─".repeat(64));
  console.log(`Eval run · ${s.total} casos · ${(s.durationMs / 1000).toFixed(1)}s`);
  console.log("─".repeat(64));

  if (s.total === 0) {
    console.log("0 casos no eval_conversations. Seed com scripts/eval-seed.mjs (slice 1.2).");
    return;
  }

  for (const c of s.cases) {
    const badge = c.error ? "💥" : c.pass ? "✓" : "✗";
    const tags = c.tags?.length ? ` [${c.tags.join(",")}]` : "";
    console.log(`${badge} ${c.title}${tags} · ${c.durationMs}ms`);
    if (c.error) {
      console.log(`    erro: ${c.error}`);
      continue;
    }
    if (!c.pass || verbose) {
      for (const ck of c.checks) {
        const m = ck.pass ? "  ✓" : "  ✗";
        const detail = ck.detail ? ` — ${ck.detail}` : "";
        console.log(`${m} ${ck.dimension}${detail}`);
        if (!ck.pass) {
          console.log(`      expected: ${fmt(ck.expected)}`);
          console.log(`      actual:   ${fmt(ck.actual)}`);
        }
      }
    }
  }

  console.log("");
  console.log(
    `Total: ${s.total} · Pass: ${s.passed} · Fail: ${s.failed} · Error: ${s.errored}`,
  );
  const rate = s.total > 0 ? ((s.passed / s.total) * 100).toFixed(1) : "—";
  console.log(`Pass rate: ${rate}%`);
}

function fmt(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
