#!/usr/bin/env node
/**
 * Smoke test da síntese ElevenLabs (Vanguard · 4.1).
 *
 *   node scripts/tts-test.mjs "oi!"
 *   node scripts/tts-test.mjs "bom dia" --voice-id=aBaVz2FTZkqVNXrDkzMV
 *   node scripts/tts-test.mjs "olá" --model=eleven_turbo_v2_5 --out=./saida.mp3
 *
 * Chama a API diretamente (sem passar pelo backend) pra validar:
 *   - ELEVENLABS_API_KEY está setada e funciona
 *   - Voice ID existe
 *   - mp3 sai do tamanho esperado (>5 KB normalmente)
 *
 * DoD do slice 4.1: roda sem erro e gera arquivo mp3 tocável.
 *
 * O script NÃO mexe no bucket de cache — isso é responsabilidade da
 * função `synthesize` em `src/lib/tts.ts`, que roda dentro do Next
 * (precisa de supabaseAdmin + env completo). Aqui só exercitamos a
 * call externa.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

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

const root = process.cwd();
const env = {
  ...loadEnvFile(resolve(root, ".env")),
  ...loadEnvFile(resolve(root, ".env.local")),
  ...process.env,
};

const args = process.argv.slice(2);
const text = args.find((a) => !a.startsWith("--"));
const voiceId =
  args.find((a) => a.startsWith("--voice-id="))?.slice(11) ??
  env.ELEVENLABS_VOICE_ID ??
  "aBaVz2FTZkqVNXrDkzMV";
const model =
  args.find((a) => a.startsWith("--model="))?.slice(8) ??
  env.ELEVENLABS_MODEL ??
  "eleven_turbo_v2_5";
const outPath =
  args.find((a) => a.startsWith("--out="))?.slice(6) ??
  `./tts-${Date.now()}.mp3`;

if (!text) {
  console.error("uso: node scripts/tts-test.mjs \"texto a sintetizar\" [--voice-id=...] [--model=...] [--out=...]");
  process.exit(1);
}

const apiKey = env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("[tts-test] ELEVENLABS_API_KEY não setada no .env / .env.local");
  process.exit(1);
}

// Mostra o hash que o backend vai usar — útil pra debug do cache.
const cacheKey = createHash("sha256")
  .update(`${voiceId}::${model}::${text.trim()}`, "utf8")
  .digest("hex");

console.log(`[tts-test] text    = "${text}"`);
console.log(`[tts-test] voice   = ${voiceId}`);
console.log(`[tts-test] model   = ${model}`);
console.log(`[tts-test] hash    = ${cacheKey}`);
console.log(`[tts-test] out     = ${outPath}`);

const t0 = Date.now();
const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
const res = await fetch(url, {
  method: "POST",
  headers: {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "audio/mpeg",
  },
  body: JSON.stringify({
    text,
    model_id: model,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    },
  }),
});

const dt = Date.now() - t0;

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`[tts-test] ElevenLabs ${res.status} (${dt}ms):`, body.slice(0, 400));
  process.exit(1);
}

const arr = await res.arrayBuffer();
const buffer = Buffer.from(arr);

if (buffer.length === 0) {
  console.error("[tts-test] resposta vazia");
  process.exit(1);
}

writeFileSync(outPath, buffer);

// Estimativa de custo — $30 / 1M chars (ver ELEVENLABS_COST_PER_MCHAR em src/lib/tts.ts)
const chars = text.trim().length;
const costUsd = (chars * 30) / 1_000_000;

console.log(`[tts-test] ✓ ${buffer.length} bytes em ${dt}ms`);
console.log(`[tts-test]   chars: ${chars} · custo estimado: $${costUsd.toFixed(6)}`);
console.log(`[tts-test]   gravei em ${outPath}`);
