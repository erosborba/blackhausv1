#!/usr/bin/env node
/**
 * Lista empreendimentos do banco pra você escolher UUIDs reais e plugar
 * nos cases de grounding em evals/seed.json (placeholders `REPLACE_WITH_REAL_EMP_ID_*`).
 *
 *   node scripts/eval-list-emps.mjs
 *   node scripts/eval-list-emps.mjs --grep=vila   # filtra nome/bairro
 *
 * Retorna só `id`, `nome`, `bairro` e contagem de chunks indexados —
 * os campos que você precisa pra decidir qual UUID cola em cada case
 * de grounding sem abrir o Supabase no browser.
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
const grepArg = args.find((a) => a.startsWith("--grep="));
const grep = grepArg ? grepArg.split("=")[1].toLowerCase() : null;

const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("faltando SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: emps, error } = await sb
  .from("empreendimentos")
  .select("id, nome, bairro, cidade, status")
  .order("nome", { ascending: true })
  .limit(200);

if (error) {
  console.error("erro:", error.message);
  process.exit(1);
}

// Conta chunks por empreendimento (RAG gap: emp sem chunk não aparece em sources).
const { data: chunks } = await sb
  .from("empreendimento_chunks")
  .select("empreendimento_id")
  .limit(50000);

const chunkCount = new Map();
for (const c of chunks ?? []) {
  const id = c.empreendimento_id;
  chunkCount.set(id, (chunkCount.get(id) ?? 0) + 1);
}

const rows = (emps ?? []).filter((e) => {
  if (!grep) return true;
  const hay = `${e.nome ?? ""} ${e.bairro ?? ""} ${e.cidade ?? ""}`.toLowerCase();
  return hay.includes(grep);
});

console.log(
  `\n${rows.length} empreendimentos${grep ? ` (grep="${grep}")` : ""}:\n`,
);

for (const e of rows) {
  const chunks = chunkCount.get(e.id) ?? 0;
  const flag = chunks === 0 ? " ⚠ sem chunks (retrieval não cita)" : "";
  console.log(
    `  ${e.id}  [${chunks} chunks]  ${e.nome ?? "(sem nome)"}  · ${e.bairro ?? "—"}/${e.cidade ?? "—"}  · ${e.status ?? "—"}${flag}`,
  );
}

console.log("\nPra popular evals/seed.json, substitua os placeholders:");
console.log("  REPLACE_WITH_REAL_EMP_ID_VILA_MARIANA  → UUID de um emp em Vila Mariana");
console.log("  REPLACE_WITH_REAL_EMP_ID_AMENITIES     → UUID de emp com academia+piscina");
console.log("  REPLACE_WITH_REAL_EMP_ID_2QUARTOS      → UUID de emp com tipologia 2Q");
console.log("  REPLACE_WITH_REAL_EMP_ID_ENTREGA       → UUID de emp pré-obras com prazo conhecido");
console.log("  REPLACE_WITH_REAL_EMP_ID_PRECO         → UUID de emp com tabela de 3Q visível");
console.log("\nPreferir emps com [chunks > 0] — sem chunks o retrieval não retorna source.\n");
