/**
 * Unit tests do leaky bucket usado pelo webhook Evolution.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { take, __resetAllBuckets } from "../rate-limit.ts";

const cfg = { capacity: 5, refillPerMinute: 60 };

test("rate-limit 1. primeira chamada é allowed e consome 1 token", () => {
  __resetAllBuckets();
  const r = take("k1", cfg);
  assert.equal(r.allowed, true);
  assert.equal(r.retryAfterMs, 0);
});

test("rate-limit 2. bursts até capacity passam, N+1 é negado", () => {
  __resetAllBuckets();
  for (let i = 0; i < cfg.capacity; i++) {
    assert.equal(take("k2", cfg).allowed, true, `burst ${i}`);
  }
  const blocked = take("k2", cfg);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test("rate-limit 3. keys isoladas — stuffing em k3 não afeta k4", () => {
  __resetAllBuckets();
  for (let i = 0; i < cfg.capacity; i++) take("k3", cfg);
  assert.equal(take("k3", cfg).allowed, false);
  assert.equal(take("k4", cfg).allowed, true);
});

test("rate-limit 4. refill calculado em fração de minuto", async () => {
  __resetAllBuckets();
  // Esgota
  for (let i = 0; i < cfg.capacity; i++) take("k5", cfg);
  assert.equal(take("k5", cfg).allowed, false);
  // 60/min = 1/s; espera ~1.1s pra reabastecer 1 token
  await new Promise((res) => setTimeout(res, 1100));
  assert.equal(take("k5", cfg).allowed, true);
});

test("rate-limit 5. retryAfterMs bate com déficit vs refill rate", () => {
  __resetAllBuckets();
  for (let i = 0; i < cfg.capacity; i++) take("k6", cfg);
  const r = take("k6", cfg);
  assert.equal(r.allowed, false);
  // déficit ~= 1 token; refillRate = 60/min → ~1000ms. Margem ampla pra
  // flutuação de clock (±200ms no CI).
  assert.ok(r.retryAfterMs >= 800 && r.retryAfterMs <= 1200, `got ${r.retryAfterMs}`);
});

test("rate-limit 6. capacidade nunca ultrapassada mesmo após longa espera", async () => {
  __resetAllBuckets();
  take("k7", cfg);
  await new Promise((res) => setTimeout(res, 100));
  // Gasta tudo — se o cap foi violado, isso passaria de 5
  let allowed = 0;
  for (let i = 0; i < cfg.capacity + 2; i++) {
    if (take("k7", cfg).allowed) allowed += 1;
  }
  assert.ok(allowed <= cfg.capacity, `allowed=${allowed}`);
});
