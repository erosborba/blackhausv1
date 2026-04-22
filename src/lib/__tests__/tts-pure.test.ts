/**
 * Unit tests da parte pura do client TTS (Track 4 · Slice 4.1).
 *
 * Só hashing e pricing. A síntese via API e o cache via Storage têm I/O
 * e caem em integration (via `scripts/tts-test.mjs` pro DoD).
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ttsCacheKey,
  computeTtsCostUsd,
  ELEVENLABS_COST_PER_MCHAR,
} from "../tts-pure.ts";

// ---------------------------------------------------------------------------
// ttsCacheKey
// ---------------------------------------------------------------------------

test("cacheKey 1. hash é determinístico — mesmo input, mesmo output", () => {
  const a = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  const b = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  assert.equal(a, b);
});

test("cacheKey 2. formato: sha256 hex (64 chars)", () => {
  const k = ttsCacheKey({ text: "bom dia", voiceId: "v1", model: "m1" });
  assert.match(k, /^[0-9a-f]{64}$/);
});

test("cacheKey 3. texto diferente → hash diferente", () => {
  const a = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  const b = ttsCacheKey({ text: "olá!", voiceId: "v1", model: "m1" });
  assert.notEqual(a, b);
});

test("cacheKey 4. voice diferente → hash diferente (mesmo texto)", () => {
  const a = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  const b = ttsCacheKey({ text: "oi!", voiceId: "v2", model: "m1" });
  assert.notEqual(a, b);
});

test("cacheKey 5. modelo diferente → hash diferente", () => {
  const a = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "turbo" });
  const b = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "multilingual" });
  assert.notEqual(a, b);
});

test("cacheKey 6. trim — whitespace em volta não invalida cache", () => {
  const a = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  const b = ttsCacheKey({ text: "  oi!  ", voiceId: "v1", model: "m1" });
  const c = ttsCacheKey({ text: "\noi!\n", voiceId: "v1", model: "m1" });
  assert.equal(a, b);
  assert.equal(a, c);
});

test("cacheKey 7. pontuação importa — prosódia muda", () => {
  // Regressão de decisão: intencional NÃO normalizar pontuação final
  // (a Eleven gera entonação diferente em "oi." vs "oi!").
  const a = ttsCacheKey({ text: "oi.", voiceId: "v1", model: "m1" });
  const b = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  assert.notEqual(a, b);
});

test("cacheKey 8. case-sensitive — 'Oi' ≠ 'oi'", () => {
  const a = ttsCacheKey({ text: "Oi!", voiceId: "v1", model: "m1" });
  const b = ttsCacheKey({ text: "oi!", voiceId: "v1", model: "m1" });
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// computeTtsCostUsd
// ---------------------------------------------------------------------------

test("cost 1. char count 0 → $0", () => {
  assert.equal(computeTtsCostUsd(0), 0);
});

test("cost 2. char count negativo → $0 (defensive)", () => {
  assert.equal(computeTtsCostUsd(-10), 0);
});

test("cost 3. 1M chars = exatamente $ELEVENLABS_COST_PER_MCHAR", () => {
  assert.equal(computeTtsCostUsd(1_000_000), ELEVENLABS_COST_PER_MCHAR);
});

test("cost 4. escala linear — 500k chars = metade", () => {
  const full = computeTtsCostUsd(1_000_000);
  const half = computeTtsCostUsd(500_000);
  assert.equal(half, full / 2);
});

test("cost 5. arredondamento em 6 casas", () => {
  // 1 char @ $30/M = $0.00003 exato — dentro da precisão
  const c = computeTtsCostUsd(1);
  assert.equal(c, 0.00003);
});

test("cost 6. determinismo", () => {
  assert.equal(computeTtsCostUsd(1234), computeTtsCostUsd(1234));
});
