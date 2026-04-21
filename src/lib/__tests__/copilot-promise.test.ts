/**
 * Unit tests de copilot-promise (Track 3 · Slice 3.5a).
 *
 * A função é pura e recebe `now` injetado, então os testes pinam datas
 * específicas em SP pra cobrir os três buckets de horário. Sem timers
 * fake, sem mocks.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCopilotPromise, promiseWindow } from "../copilot-promise.ts";

// ──────────────────────────────────────────────────────────────────────
// Helper: cria Date em horário local de SP (GMT-03:00).
// Constrói como UTC + 3h pra que, depois do shift -3h dentro da lib,
// retorne o dia/hora desejados em SP.
// ──────────────────────────────────────────────────────────────────────
function spDate(iso: string): Date {
  // iso: "2026-04-23T14:30:00" (interpretado como SP local)
  // → UTC = iso + 3h
  const [date, time] = iso.split("T");
  const [Y, M, D] = date.split("-").map(Number);
  const [h, m = "0", s = "0"] = (time ?? "00").split(":");
  const utc = Date.UTC(Y, M - 1, D, Number(h) + 3, Number(m), Number(s));
  return new Date(utc);
}

// ──────────────────────────────────────────────────────────────────────
// promiseWindow — bucket por hora/dia
// ──────────────────────────────────────────────────────────────────────

test("promiseWindow 1. terça 10h em SP = business_hours", () => {
  // 2026-04-21 é uma terça-feira
  assert.equal(promiseWindow(spDate("2026-04-21T10:00:00")), "business_hours");
});

test("promiseWindow 2. sexta 14h em SP = business_hours", () => {
  // 2026-04-24 é uma sexta-feira
  assert.equal(promiseWindow(spDate("2026-04-24T14:30:00")), "business_hours");
});

test("promiseWindow 3. seg 08:59 em SP = off_hours (antes do expediente)", () => {
  // 2026-04-20 é uma segunda-feira
  assert.equal(promiseWindow(spDate("2026-04-20T08:59:00")), "off_hours");
});

test("promiseWindow 4. seg 09:00 em SP = business_hours (início)", () => {
  assert.equal(promiseWindow(spDate("2026-04-20T09:00:00")), "business_hours");
});

test("promiseWindow 5. seg 17:59 em SP = business_hours (último minuto)", () => {
  assert.equal(promiseWindow(spDate("2026-04-20T17:59:00")), "business_hours");
});

test("promiseWindow 6. seg 18:00 em SP = evening", () => {
  assert.equal(promiseWindow(spDate("2026-04-20T18:00:00")), "evening");
});

test("promiseWindow 7. seg 21:59 em SP = evening (último minuto)", () => {
  assert.equal(promiseWindow(spDate("2026-04-20T21:59:00")), "evening");
});

test("promiseWindow 8. seg 22:00 em SP = off_hours", () => {
  assert.equal(promiseWindow(spDate("2026-04-20T22:00:00")), "off_hours");
});

test("promiseWindow 9. madrugada (03h) em dia útil = off_hours", () => {
  assert.equal(promiseWindow(spDate("2026-04-21T03:00:00")), "off_hours");
});

test("promiseWindow 10. sábado 14h em SP = off_hours", () => {
  // 2026-04-25 é sábado
  assert.equal(promiseWindow(spDate("2026-04-25T14:00:00")), "off_hours");
});

test("promiseWindow 11. domingo 10h em SP = off_hours", () => {
  // 2026-04-26 é domingo
  assert.equal(promiseWindow(spDate("2026-04-26T10:00:00")), "off_hours");
});

// ──────────────────────────────────────────────────────────────────────
// buildCopilotPromise — linguagem por bucket
// ──────────────────────────────────────────────────────────────────────

test("promise 1. business_hours fala 'em instantes'", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T10:00:00"),
    kind: "simulation",
  });
  assert.match(text, /em instantes/i);
  assert.doesNotMatch(text, /amanhã/i);
});

test("promise 2. evening fala 'ainda hoje'", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T19:30:00"),
    kind: "simulation",
  });
  assert.match(text, /ainda hoje/i);
});

test("promise 3. off_hours fala 'amanhã cedo'", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T23:30:00"),
    kind: "simulation",
  });
  assert.match(text, /amanhã cedo/i);
});

test("promise 4. fim de semana fala 'amanhã cedo'", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-25T14:00:00"),
    kind: "simulation",
  });
  assert.match(text, /amanhã cedo/i);
});

test("promise 5. kind=simulation menciona 'números'", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T10:00:00"),
    kind: "simulation",
  });
  assert.match(text, /números/i);
  assert.doesNotMatch(text, /faixa/i);
});

test("promise 6. kind=mcmv menciona 'faixa' + 'MCMV'", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T10:00:00"),
    kind: "mcmv",
  });
  assert.match(text, /faixa/i);
  assert.match(text, /MCMV/);
});

test("promise 7. nome personaliza o texto", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T10:00:00"),
    kind: "simulation",
    nome: "Carlos",
  });
  assert.match(text, /^Carlos, /);
});

test("promise 8. sem nome não adiciona vírgula fantasma", () => {
  const text = buildCopilotPromise({
    now: spDate("2026-04-21T10:00:00"),
    kind: "simulation",
  });
  // Começa com letra minúscula (continuação natural da frase)
  assert.ok(/^[a-záéíóú]/.test(text), `text="${text}"`);
});

test("promise 9. NUNCA inclui valores numéricos em R$ (safety)", () => {
  // Este é o invariant chave: o texto-promessa não pode vazar número.
  const textBH = buildCopilotPromise({
    now: spDate("2026-04-21T10:00:00"),
    kind: "simulation",
    nome: "Ana",
  });
  const textEve = buildCopilotPromise({
    now: spDate("2026-04-21T20:00:00"),
    kind: "mcmv",
  });
  const textOff = buildCopilotPromise({
    now: spDate("2026-04-25T14:00:00"),
    kind: "simulation",
  });
  for (const t of [textBH, textEve, textOff]) {
    assert.doesNotMatch(t, /R\$/, "não pode conter R$");
    assert.doesNotMatch(t, /\d/, "não pode conter dígito");
    assert.doesNotMatch(t, /\b\d+%/, "não pode conter %");
  }
});

test("promise 10. determinismo — mesmo input = mesmo output", () => {
  const now = spDate("2026-04-21T10:00:00");
  const a = buildCopilotPromise({ now, kind: "simulation", nome: "Ana" });
  const b = buildCopilotPromise({ now, kind: "simulation", nome: "Ana" });
  assert.equal(a, b);
});
