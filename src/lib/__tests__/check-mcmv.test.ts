/**
 * Unit tests da lógica do check_mcmv (Track 3 · Slice 3.4).
 *
 * Testa `computeMcmvResponse` — a parte pura. O wrapper com config
 * (`src/agent/tools/check-mcmv.ts`) só carrega flags e delega.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMcmvResponse,
  type McmvFlagsSubset,
} from "../mcmv-response.ts";

const ENABLED: McmvFlagsSubset = { mcmvEnabled: true };
const DISABLED: McmvFlagsSubset = { mcmvEnabled: false };

test("mcmv-tool 1. feature desligada retorna mcmv_disabled", () => {
  const r = computeMcmvResponse({ renda: 3000, primeiro_imovel: true }, DISABLED);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "mcmv_disabled");
    assert.match(r.text, /desativada|corretor/i);
  }
});

test("mcmv-tool 2. renda inválida (0) → renda_invalida", () => {
  const r = computeMcmvResponse({ renda: 0, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "renda_invalida");
    assert.match(r.text, /renda/i);
  }
});

test("mcmv-tool 3. primeiro_imovel omitted → pergunta antes de calcular", () => {
  const r = computeMcmvResponse({ renda: 3500 }, ENABLED);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "primeiro_imovel_nao_informado");
    assert.match(r.text, /primeiro imóvel/i);
  }
});

test("mcmv-tool 4. primeiro_imovel=false → nao_primeiro_imovel + oferta de SBPE", () => {
  const r = computeMcmvResponse({ renda: 3500, primeiro_imovel: false }, ENABLED);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "nao_primeiro_imovel");
    assert.match(r.text, /SBPE|SAC/i);
  }
});

test("mcmv-tool 5. renda acima de R$8.000 → renda_acima_teto sem fail absoluto", () => {
  const r = computeMcmvResponse({ renda: 12_000, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "renda_acima_teto");
    assert.match(r.text, /SBPE|simular/i);
  }
});

test("mcmv-tool 6. renda R$2.000 → urbano_1 + texto menciona subsídio + taxa pt-BR", () => {
  const r = computeMcmvResponse({ renda: 2000, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.band.id, "urbano_1");
    assert.match(r.text, /Urbano 1/i);
    assert.match(r.text, /subsídio/i);
    assert.match(r.text, /4,25%/); // vírgula decimal
  }
});

test("mcmv-tool 7. renda R$6.000 → urbano_3 + texto NÃO menciona subsídio (é zero)", () => {
  const r = computeMcmvResponse({ renda: 6000, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.band.id, "urbano_3");
    assert.doesNotMatch(r.text, /subsídio/i);
  }
});

test("mcmv-tool 8. nome personaliza o texto", () => {
  const r = computeMcmvResponse(
    { renda: 3500, primeiro_imovel: true, nome: "Ana" },
    ENABLED,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /Ana/);
  }
});

test("mcmv-tool 9. sem nome — texto sem vírgula órfã", () => {
  const r = computeMcmvResponse({ renda: 3500, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.doesNotMatch(r.text, /,,|,\s+,/);
    assert.match(r.text, /Com essa renda, você/);
  }
});

test("mcmv-tool 10. output sucesso inclui source_date ISO", () => {
  const r = computeMcmvResponse({ renda: 2000, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.source_date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("mcmv-tool 11. teto de imóvel formatado em BRL no texto", () => {
  const r = computeMcmvResponse({ renda: 2000, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, true);
  if (r.ok) {
    // urbano_1: maxPropertyValue = 264000 → "R$ 264.000" (pt-BR)
    assert.match(r.text, /R\$\s?264\.000/);
  }
});

test("mcmv-tool 12. renda NaN → renda_invalida (não crasha)", () => {
  const r = computeMcmvResponse({ renda: Number.NaN, primeiro_imovel: true }, ENABLED);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "renda_invalida");
  }
});
