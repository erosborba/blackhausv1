#!/usr/bin/env node
/**
 * Aponta o webhook da instância Evolution pro dev (ngrok) ou pro prod.
 *
 *   node scripts/set-webhook.mjs dev
 *   node scripts/set-webhook.mjs prod
 *   node scripts/set-webhook.mjs status
 *
 * Lê EVOLUTION_BASE_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE do .env.local
 * (fallback .env). Usa APP_BASE_URL pra dev e APP_PROD_URL pra prod — ou
 * override via --url=<...>.
 */
import { readFileSync, existsSync } from "node:fs";
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Next-style: .env.local sobrepõe .env.
const root = process.cwd();
const env = { ...loadEnvFile(resolve(root, ".env")), ...loadEnvFile(resolve(root, ".env.local")), ...process.env };

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--")) ?? "status";
const urlOverride = args.find((a) => a.startsWith("--url="))?.slice(6);

const EVO_URL = (env.EVOLUTION_BASE_URL || "").replace(/\/$/, "");
const EVO_KEY = env.EVOLUTION_API_KEY;
const INSTANCE = env.EVOLUTION_INSTANCE || "blackhaus";
const DEV_URL = (env.APP_BASE_URL || "").replace(/\/$/, "");
const PROD_URL = (env.APP_PROD_URL || "https://blackhaus.site").replace(/\/$/, "");

if (!EVO_URL || !EVO_KEY) {
  console.error("[webhook] faltando EVOLUTION_BASE_URL ou EVOLUTION_API_KEY no .env.local");
  process.exit(1);
}

async function callEvo(path, init = {}) {
  const res = await fetch(`${EVO_URL}${path}`, {
    ...init,
    headers: {
      apikey: EVO_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function setWebhook(target) {
  if (!target) {
    console.error("[webhook] URL alvo vazia. Define APP_BASE_URL (dev) ou passe --url=<...>.");
    process.exit(1);
  }
  const full = `${target}/api/webhook/evolution`;
  const payload = {
    webhook: {
      enabled: true,
      url: full,
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
    },
  };
  console.log(`[webhook] setando pra: ${full}`);
  const r = await callEvo(`/webhook/set/${INSTANCE}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  console.log(`[webhook] resposta ${r.status}:`, typeof r.body === "string" ? r.body.slice(0, 400) : r.body);
  if (!r.ok) process.exit(1);
}

async function getStatus() {
  const r = await callEvo(`/webhook/find/${INSTANCE}`);
  console.log(`[webhook] status ${r.status}:`, r.body);
}

(async () => {
  if (mode === "status") return getStatus();
  if (mode === "dev") return setWebhook(urlOverride || DEV_URL);
  if (mode === "prod") return setWebhook(urlOverride || PROD_URL);
  console.error(`[webhook] modo desconhecido: ${mode}. Use dev | prod | status`);
  process.exit(1);
})().catch((e) => {
  console.error("[webhook] erro:", e);
  process.exit(1);
});
