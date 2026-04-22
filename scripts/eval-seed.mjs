#!/usr/bin/env node
/**
 * Seeder do eval set — Track 1 · Slice 1.2.
 *
 *   node scripts/eval-seed.mjs                # upsert baseline evals/seed.json
 *   node scripts/eval-seed.mjs --file=my.json # seed de outro arquivo
 *   node scripts/eval-seed.mjs --dry          # só printa o que ia inserir
 *   node scripts/eval-seed.mjs --reset        # apaga TUDO e re-seeda
 *
 * Conecta direto no Postgres via SUPABASE_URL + SUPABASE_SECRET_KEY
 * (mesmas envs que o app). Upsert por `title` — re-rodar é idempotente.
 *
 * Invariants: I-4 (evaluation-first). Casos são a unidade de verdade do
 * comportamento esperado da Bia.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
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
const dry = args.includes("--dry");
const reset = args.includes("--reset");
const fileArg = args.find((a) => a.startsWith("--file="))?.slice(7);
const file = fileArg || "evals/seed.json";

const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SECRET_KEY) {
  console.error("[seed] SUPABASE_URL / SUPABASE_SECRET_KEY faltando.");
  process.exit(2);
}

const path = resolve(root, file);
if (!existsSync(path)) {
  console.error(`[seed] arquivo não encontrado: ${path}`);
  process.exit(2);
}

const seed = JSON.parse(readFileSync(path, "utf8"));
const convs = Array.isArray(seed.conversations) ? seed.conversations : [];
console.log(`[seed] ${convs.length} conversas em ${file}`);

if (dry) {
  for (const c of convs) {
    console.log(`  • ${c.title} [${(c.tags || []).join(",")}] · ${(c.lead_messages || []).length} turnos`);
  }
  process.exit(0);
}

const sb = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (reset) {
  console.log("[seed] --reset: apagando todas as linhas de eval_conversations");
  const { error } = await sb
    .from("eval_conversations")
    .delete()
    .gte("created_at", "1900-01-01");
  if (error) {
    console.error("[seed] delete falhou:", error.message);
    process.exit(1);
  }
}

let inserted = 0;
let updated = 0;
let failed = 0;

for (const c of convs) {
  const row = {
    title: c.title,
    lead_messages: c.lead_messages ?? [],
    initial_lead: c.initial_lead ?? {},
    expected: c.expected ?? {},
    tags: c.tags ?? [],
    notes: c.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  // Idempotência por title: busca existing; insere ou atualiza.
  const { data: existing } = await sb
    .from("eval_conversations")
    .select("id")
    .eq("title", row.title)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from("eval_conversations")
      .update(row)
      .eq("id", existing.id);
    if (error) {
      console.error(`  ✗ update falhou (${row.title}):`, error.message);
      failed++;
    } else {
      console.log(`  ↻ ${row.title}`);
      updated++;
    }
  } else {
    const { error } = await sb.from("eval_conversations").insert(row);
    if (error) {
      console.error(`  ✗ insert falhou (${row.title}):`, error.message);
      failed++;
    } else {
      console.log(`  + ${row.title}`);
      inserted++;
    }
  }
}

console.log("");
console.log(`[seed] inseridos=${inserted} atualizados=${updated} falhos=${failed}`);
process.exit(failed > 0 ? 1 : 0);
