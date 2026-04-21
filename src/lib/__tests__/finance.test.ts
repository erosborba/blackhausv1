/**
 * Unit tests da lib pura de finance (Track 3 · Slice 3.1).
 *
 *   npm run test:unit
 *
 * Cobre: SBPE, SAC, MCMV, FGTS, ITBI. 33+ casos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sbpe,
  sac,
  mcmvBand,
  fgtsEligible,
  itbi,
  MCMV_BANDS,
  MCMV_SOURCE_DATE,
  FGTS_MIN_MONTHS_CLT,
  FGTS_SFH_CEILING,
} from "../finance.ts";

// ──────────────────────────────────────────────────────────────────────
// SBPE
// ──────────────────────────────────────────────────────────────────────

test("sbpe 1. caso canônico 400k @ 11.5% em 360m — parcela bate ~R$3963", () => {
  const r = sbpe({ principal: 400_000, rateAnnual: 0.115, months: 360 });
  // PMT = 400000 * 0.115/12 / (1 - (1+0.115/12)^-360) ≈ 3963.15
  assert.ok(
    Math.abs(r.firstPayment - 3963.15) < 2,
    `esperava ~3963.15, veio ${r.firstPayment}`,
  );
  assert.equal(r.system, "sbpe");
});

test("sbpe 2. parcela constante (first === last)", () => {
  const r = sbpe({ principal: 250_000, rateAnnual: 0.09, months: 240 });
  assert.equal(r.firstPayment, r.lastPayment);
});

test("sbpe 3. taxa zero vira amortização linear (P/n)", () => {
  const r = sbpe({ principal: 360_000, rateAnnual: 0, months: 360 });
  assert.equal(r.firstPayment, 1000);
  assert.equal(r.lastPayment, 1000);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.totalPaid, 360_000);
});

test("sbpe 4. totalPaid > principal sempre (com juros > 0)", () => {
  const r = sbpe({ principal: 500_000, rateAnnual: 0.08, months: 300 });
  assert.ok(r.totalPaid > 500_000);
  assert.ok(r.totalInterest > 0);
});

test("sbpe 5. totalInterest = totalPaid − principal", () => {
  const r = sbpe({ principal: 400_000, rateAnnual: 0.115, months: 360 });
  assert.ok(Math.abs(r.totalInterest - (r.totalPaid - 400_000)) < 0.5);
});

test("sbpe 6. 120m tem parcela maior mas total menor que 360m", () => {
  const curto = sbpe({ principal: 400_000, rateAnnual: 0.115, months: 120 });
  const longo = sbpe({ principal: 400_000, rateAnnual: 0.115, months: 360 });
  assert.ok(curto.firstPayment > longo.firstPayment, "parcela curta > longa");
  assert.ok(curto.totalInterest < longo.totalInterest, "juros curto < longo");
});

test("sbpe 7. principal ≤ 0 joga erro", () => {
  assert.throws(() => sbpe({ principal: 0, rateAnnual: 0.1, months: 360 }));
  assert.throws(() => sbpe({ principal: -1, rateAnnual: 0.1, months: 360 }));
});

test("sbpe 8. months não inteiro joga erro", () => {
  assert.throws(() => sbpe({ principal: 400_000, rateAnnual: 0.1, months: 360.5 }));
  assert.throws(() => sbpe({ principal: 400_000, rateAnnual: 0.1, months: 0 }));
});

test("sbpe 9. cetAnnual espelha rateAnnual (sem taxas extras)", () => {
  const r = sbpe({ principal: 400_000, rateAnnual: 0.115, months: 360 });
  assert.equal(r.cetAnnual, 0.115);
});

// ──────────────────────────────────────────────────────────────────────
// SAC
// ──────────────────────────────────────────────────────────────────────

test("sac 1. primeira parcela > última (decrescente)", () => {
  const r = sac({ principal: 400_000, rateAnnual: 0.115, months: 360 });
  assert.ok(r.firstPayment > r.lastPayment);
});

test("sac 2. caso canônico 400k @ 11.5% em 360m — first ~R$4944, last ~R$1123", () => {
  // amort = 400000/360 = 1111.11; juros1 = 400000 * 0.115/12 ≈ 3833.33
  // first = 1111.11 + 3833.33 ≈ 4944.44
  // last = 1111.11 + 1111.11 * 0.115/12 ≈ 1121.76
  const r = sac({ principal: 400_000, rateAnnual: 0.115, months: 360 });
  assert.ok(Math.abs(r.firstPayment - 4944.44) < 2, `first=${r.firstPayment}`);
  assert.ok(Math.abs(r.lastPayment - 1121.76) < 2, `last=${r.lastPayment}`);
});

test("sac 3. total de juros = r · P · (n+1) / 2", () => {
  const P = 300_000;
  const rateAnnual = 0.09;
  const n = 240;
  const expected = ((rateAnnual / 12) * P * (n + 1)) / 2;
  const r = sac({ principal: P, rateAnnual, months: n });
  assert.ok(Math.abs(r.totalInterest - expected) < 0.5);
});

test("sac 4. taxa zero: first = last = P/n", () => {
  const r = sac({ principal: 360_000, rateAnnual: 0, months: 360 });
  assert.equal(r.firstPayment, 1000);
  assert.equal(r.lastPayment, 1000);
  assert.equal(r.totalInterest, 0);
});

test("sac 5. totalPaid = principal + totalInterest", () => {
  const r = sac({ principal: 500_000, rateAnnual: 0.08, months: 300 });
  assert.ok(Math.abs(r.totalPaid - (500_000 + r.totalInterest)) < 0.5);
});

test("sac 6. para mesmo P/rate/n, SAC tem juros totais menores que SBPE", () => {
  const input = { principal: 400_000, rateAnnual: 0.115, months: 360 };
  const a = sbpe(input);
  const b = sac(input);
  assert.ok(b.totalInterest < a.totalInterest, "SAC < SBPE em juros totais");
});

test("sac 7. rateAnnual negativa joga erro", () => {
  assert.throws(() => sac({ principal: 400_000, rateAnnual: -0.01, months: 360 }));
});

// ──────────────────────────────────────────────────────────────────────
// MCMV
// ──────────────────────────────────────────────────────────────────────

test("mcmv 1. renda 2000 → urbano_1", () => {
  const r = mcmvBand({ renda: 2000, primeiroImovel: true });
  assert.ok(r.eligible);
  if (r.eligible) assert.equal(r.band.id, "urbano_1");
});

test("mcmv 2. renda 3500 → urbano_2", () => {
  const r = mcmvBand({ renda: 3500, primeiroImovel: true });
  assert.ok(r.eligible);
  if (r.eligible) assert.equal(r.band.id, "urbano_2");
});

test("mcmv 3. renda 6000 → urbano_3", () => {
  const r = mcmvBand({ renda: 6000, primeiroImovel: true });
  assert.ok(r.eligible);
  if (r.eligible) assert.equal(r.band.id, "urbano_3");
});

test("mcmv 4. renda 10000 → acima do teto, não elegível", () => {
  const r = mcmvBand({ renda: 10_000, primeiroImovel: true });
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "renda_acima_teto");
});

test("mcmv 5. renda 0 → renda_invalida", () => {
  const r = mcmvBand({ renda: 0, primeiroImovel: true });
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "renda_invalida");
});

test("mcmv 6. primeiroImovel=false derruba elegibilidade", () => {
  const r = mcmvBand({ renda: 2000, primeiroImovel: false });
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "nao_primeiro_imovel");
});

test("mcmv 7. MCMV_BANDS é frozen", () => {
  assert.ok(Object.isFrozen(MCMV_BANDS));
});

test("mcmv 8. MCMV_BANDS está em ordem crescente de maxIncome", () => {
  for (let i = 1; i < MCMV_BANDS.length; i++) {
    assert.ok(
      MCMV_BANDS[i].maxIncome > MCMV_BANDS[i - 1].maxIncome,
      `faixa ${i} deveria ter maxIncome > faixa ${i - 1}`,
    );
  }
});

test("mcmv 9. MCMV_SOURCE_DATE é ISO válido", () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(MCMV_SOURCE_DATE));
  assert.ok(!Number.isNaN(new Date(MCMV_SOURCE_DATE).getTime()));
});

test("mcmv 10. urbano_1 tem subsídio, urbano_3 não tem", () => {
  const b1 = MCMV_BANDS.find((b) => b.id === "urbano_1");
  const b3 = MCMV_BANDS.find((b) => b.id === "urbano_3");
  assert.ok(b1 && b1.subsidyMax > 0);
  assert.ok(b3 && b3.subsidyMax === 0);
});

// ──────────────────────────────────────────────────────────────────────
// FGTS
// ──────────────────────────────────────────────────────────────────────

test("fgts 1. < 36 meses CLT → não elegível", () => {
  const r = fgtsEligible({ monthsClt: 24, isFirstHome: true });
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "tempo_clt_insuficiente");
});

test("fgts 2. 36 meses + primeiro imóvel + valor 500k → elegível", () => {
  const r = fgtsEligible({
    monthsClt: 36,
    isFirstHome: true,
    propertyValue: 500_000,
  });
  assert.equal(r.eligible, true);
});

test("fgts 3. 60 meses + não primeiro imóvel → não elegível", () => {
  const r = fgtsEligible({ monthsClt: 60, isFirstHome: false });
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "nao_primeiro_imovel");
});

test("fgts 4. valor > 1.5M → não elegível (teto SFH)", () => {
  const r = fgtsEligible({
    monthsClt: 60,
    isFirstHome: true,
    propertyValue: 1_800_000,
  });
  assert.equal(r.eligible, false);
  if (!r.eligible) assert.equal(r.reason, "imovel_acima_teto_sfh");
});

test("fgts 5. sem propertyValue → checagem de teto é skip (elegível)", () => {
  const r = fgtsEligible({ monthsClt: 48, isFirstHome: true });
  assert.equal(r.eligible, true);
});

test("fgts 6. constantes expostas batem com schema SFH", () => {
  assert.equal(FGTS_MIN_MONTHS_CLT, 36);
  assert.equal(FGTS_SFH_CEILING, 1_500_000);
});

// ──────────────────────────────────────────────────────────────────────
// ITBI
// ──────────────────────────────────────────────────────────────────────

test("itbi 1. 400k @ 200 bps (2%) = 8.000", () => {
  assert.equal(itbi(400_000, 200), 8_000);
});

test("itbi 2. 500k @ 250 bps (2.5%) = 12.500", () => {
  assert.equal(itbi(500_000, 250), 12_500);
});

test("itbi 3. rateBps zero = 0", () => {
  assert.equal(itbi(400_000, 0), 0);
});

test("itbi 4. valor negativo joga erro", () => {
  assert.throws(() => itbi(-1, 200));
});

test("itbi 5. rateBps negativo joga erro", () => {
  assert.throws(() => itbi(400_000, -10));
});

test("itbi 6. valor não-finito joga erro", () => {
  assert.throws(() => itbi(Number.POSITIVE_INFINITY, 200));
  assert.throws(() => itbi(Number.NaN, 200));
});
