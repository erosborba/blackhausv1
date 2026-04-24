/**
 * Cobertura do classifier do pre-tool-call de tabela de preços.
 *
 * Foco: garantir que mensagens reais de leads (com hedges, acentos,
 * grafias variadas) sejam classificadas corretamente. Cada falha aqui
 * vira um stall "vou perguntar pro consultor" em produção.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQueryIntent } from "../../agent/tabela-precos-classifier.ts";

// ─── tipologia: studio/estudio/estúdio ─────────────────────────────────────

test("tipologia 'studio' → Studio", () => {
  const r = classifyQueryIntent("tem studio até 400 mil?");
  assert.equal(r?.kind, "filtrar");
  assert.equal(r?.kind === "filtrar" && r.tipologia, "Studio");
});

test("tipologia 'estudio' (sem acento) → Studio", () => {
  const r = classifyQueryIntent("queria um estudio em curitiba");
  assert.equal(r?.kind, "filtrar");
  assert.equal(r?.kind === "filtrar" && r.tipologia, "Studio");
});

test("tipologia 'estúdio' (com acento) → Studio (regressão BIA)", () => {
  // Caso real de produção (lead da91854c, 2026-04-24): "Bia, você tem
  // algum valor de algum estúdio no centro, até uns 400 mil?". Antes do
  // fix esse classify retornava null → Bia respondia "vou confirmar com
  // o consultor" sem injetar o bloco TABELA_PRECOS_MATCH.
  const r = classifyQueryIntent("você tem algum valor de algum estúdio no centro, até uns 400 mil?");
  assert.equal(r?.kind, "filtrar");
  assert.equal(r?.kind === "filtrar" && r.tipologia, "Studio");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 400_000);
});

test("tipologia 'estudios' (plural sem acento) → Studio", () => {
  const r = classifyQueryIntent("vocês têm estudios disponíveis?");
  // Sem faixa nem preço → cai no listar_tipologias só se tiver keyword;
  // como tem só tipologia, ainda assim deve filtrar (sub.tipologia preenchida).
  assert.equal(r?.kind, "filtrar");
  assert.equal(r?.kind === "filtrar" && r.tipologia, "Studio");
});

// ─── faixa de preço: hedges ────────────────────────────────────────────────

test("'até 400 mil' → max=400000", () => {
  const r = classifyQueryIntent("studio até 400 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 400_000);
});

test("'até uns 400 mil' (hedge 'uns') → max=400000 (regressão BIA)", () => {
  const r = classifyQueryIntent("studio até uns 400 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 400_000);
});

test("'até uma 350 mil' (hedge 'uma') → max=350000", () => {
  const r = classifyQueryIntent("2q até uma 350 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 350_000);
});

test("'até aproximadamente 500 mil' → max=500000", () => {
  const r = classifyQueryIntent("studio até aproximadamente 500 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 500_000);
});

test("'até cerca de 600 mil' → max=600000", () => {
  const r = classifyQueryIntent("1q até cerca de 600 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 600_000);
});

test("'menos de uns 300 mil' → max=300000", () => {
  const r = classifyQueryIntent("studio menos de uns 300 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_max, 300_000);
});

test("'entre 300 e 500 mil' → min=300k, max=500k", () => {
  const r = classifyQueryIntent("studio entre 300 e 500 mil");
  assert.equal(r?.kind === "filtrar" && r.preco_min, 300_000);
  assert.equal(r?.kind === "filtrar" && r.preco_max, 500_000);
});

// ─── unidade por número (não regressão dos fixes) ──────────────────────────

test("'unidade 1811' → unidade_por_numero", () => {
  const r = classifyQueryIntent("qual o valor da unidade 1811?");
  assert.equal(r?.kind, "unidade_por_numero");
  assert.equal(r?.kind === "unidade_por_numero" && r.numero, "1811");
});

test("'400' isolado NÃO é unidade (filtra preço/ano)", () => {
  // 400 % 100 === 0 → bloqueado pelo filtro isLikelyUnit
  const r = classifyQueryIntent("tem algo por 400?");
  // Sem keyword "mil"/"R$", o "400" vira ambiguo. Aceitável: null OU
  // filtrar com preco_max=400 (parseMoney trata < 10000 como mil).
  // O importante é NÃO ser unidade_por_numero.
  if (r) assert.notEqual(r.kind, "unidade_por_numero");
});

// ─── intent aberta ─────────────────────────────────────────────────────────

test("'quais tipologias?' → listar_tipologias", () => {
  const r = classifyQueryIntent("quais tipologias vocês têm?");
  assert.equal(r?.kind, "listar_tipologias");
});

test("'quando entrega?' → resumo (puxa entrega_prevista)", () => {
  const r = classifyQueryIntent("quando entrega o prédio?");
  assert.equal(r?.kind, "resumo");
});

// ─── nada relevante ────────────────────────────────────────────────────────

test("saudação genérica → null", () => {
  const r = classifyQueryIntent("oi tudo bem?");
  assert.equal(r, null);
});
