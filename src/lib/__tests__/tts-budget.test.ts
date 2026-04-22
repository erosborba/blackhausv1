/**
 * Unit tests da parte pura do budget (Track 4 · Slice 4.4).
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinBudget } from "../tts-pure.ts";

test("budget 1. cap>0 sem gasto prévio → passa", () => {
  assert.equal(
    isWithinBudget({ spentTodayUsd: 0, pendingUsd: 0.1, capUsd: 2 }),
    true,
  );
});

test("budget 2. spent + pending EXATAMENTE no cap → passa (inclusivo)", () => {
  assert.equal(
    isWithinBudget({ spentTodayUsd: 1.5, pendingUsd: 0.5, capUsd: 2 }),
    true,
  );
});

test("budget 3. spent + pending 1 centavo acima → bloqueia", () => {
  assert.equal(
    isWithinBudget({ spentTodayUsd: 1.5, pendingUsd: 0.51, capUsd: 2 }),
    false,
  );
});

test("budget 4. cap=0 → sempre bloqueia (kill switch)", () => {
  assert.equal(
    isWithinBudget({ spentTodayUsd: 0, pendingUsd: 0, capUsd: 0 }),
    false,
  );
});

test("budget 5. cap negativo → bloqueia (defensive)", () => {
  assert.equal(
    isWithinBudget({ spentTodayUsd: 0, pendingUsd: 0, capUsd: -1 }),
    false,
  );
});

test("budget 6. pending=0 só verifica spent atual", () => {
  assert.equal(
    isWithinBudget({ spentTodayUsd: 1.99, pendingUsd: 0, capUsd: 2 }),
    true,
  );
  assert.equal(
    isWithinBudget({ spentTodayUsd: 2.01, pendingUsd: 0, capUsd: 2 }),
    false,
  );
});

test("budget 7. determinismo", () => {
  const args = { spentTodayUsd: 1.234, pendingUsd: 0.5, capUsd: 2 };
  assert.equal(isWithinBudget(args), isWithinBudget(args));
});
