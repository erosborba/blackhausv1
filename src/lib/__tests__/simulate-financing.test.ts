/**
 * Unit tests da lógica do simulate_financing (Track 3 · Slice 3.3).
 *
 * Testa `computeSimulationResponse` — a parte pura. Cobertura foca em:
 *   - Guardrails (feature flags + preço explícito)
 *   - Shape do output e propagação de defaults
 *   - Formatação pt-BR do texto
 *   - SBPE vs SAC
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSimulationResponse,
  type SimulationFlagsSubset,
  type SimulationDefaults,
} from "../simulation-response.ts";

const FLAGS_ON: SimulationFlagsSubset = {
  simulateEnabled: true,
  requireExplicitPrice: true,
};

const FLAGS_PERMISSIVE: SimulationFlagsSubset = {
  simulateEnabled: true,
  requireExplicitPrice: false,
};

const FLAGS_OFF: SimulationFlagsSubset = {
  simulateEnabled: false,
  requireExplicitPrice: true,
};

const DEFAULTS: SimulationDefaults = {
  entryPct: 20,
  termMonths: 360,
  sbpeRateAnnual: 0.115,
};

// ──────────────────────────────────────────────────────────────────────
// Guardrails
// ──────────────────────────────────────────────────────────────────────

test("sim 1. feature desligada → simulate_disabled", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_OFF,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "simulate_disabled");
});

test("sim 2. sem price_source + requireExplicitPrice=true → needs_price", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000 },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "needs_price");
    assert.match(r.text, /valor/i);
  }
});

test("sim 3. price_source='lead' libera o guardrail", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
});

test("sim 4. price_source='empreendimento' libera o guardrail", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 480_000, price_source: "empreendimento" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    // Texto cola "a partir de" quando source=empreendimento
    assert.match(r.text, /a partir de/i);
  }
});

test("sim 5. requireExplicitPrice=false aceita price_source='none'", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000 },
    FLAGS_PERMISSIVE,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
});

// ──────────────────────────────────────────────────────────────────────
// Validação de input
// ──────────────────────────────────────────────────────────────────────

test("sim 6. preco_imovel 0 ou negativo → preco_invalido", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 0, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "preco_invalido");
});

test("sim 7. preco NaN → preco_invalido (não crasha)", () => {
  const r = computeSimulationResponse(
    { preco_imovel: Number.NaN, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "preco_invalido");
});

test("sim 8. prazo não-inteiro → prazo_invalido", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, prazo_meses: 360.5, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "prazo_invalido");
});

test("sim 9. entrada negativa → entrada_invalida", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, entrada: -1, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "entrada_invalida");
});

test("sim 10. entrada ≥ preco → entrada_maior_que_preco", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, entrada: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "entrada_maior_que_preco");
});

// ──────────────────────────────────────────────────────────────────────
// Defaults e cálculos
// ──────────────────────────────────────────────────────────────────────

test("sim 11. defaults: entrada 20% + 360m + taxa 11.5% SBPE", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.sistema, "sbpe");
    assert.equal(r.entrada, 80_000);
    assert.equal(r.principal, 320_000);
    assert.equal(r.prazo_meses, 360);
    assert.equal(r.taxa_anual, 0.115);
    // PMT(320000, 0.115/12, 360) ≈ 3170.52
    assert.ok(Math.abs(r.parcela_inicial - 3170.52) < 2, `parcela=${r.parcela_inicial}`);
    assert.equal(r.parcela_inicial, r.parcela_final); // SBPE constante
  }
});

test("sim 12. sistema=SAC produz parcela decrescente", () => {
  const r = computeSimulationResponse(
    {
      preco_imovel: 400_000,
      sistema: "sac",
      price_source: "lead",
    },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.sistema, "sac");
    assert.ok(r.parcela_inicial > r.parcela_final);
  }
});

test("sim 13. taxa_anual override funciona", () => {
  const r = computeSimulationResponse(
    {
      preco_imovel: 400_000,
      taxa_anual: 0.08,
      price_source: "lead",
    },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.taxa_anual, 0.08);
  }
});

test("sim 14. entrada explícita sobrepõe o % default", () => {
  const r = computeSimulationResponse(
    {
      preco_imovel: 500_000,
      entrada: 150_000,
      price_source: "lead",
    },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.entrada, 150_000);
    assert.equal(r.principal, 350_000);
  }
});

test("sim 15. total_pago = entrada + total parcelas (aproximado)", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    const expected = r.entrada + r.principal + r.total_juros;
    assert.ok(Math.abs(r.total_pago - expected) < 1);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Formatação do texto
// ──────────────────────────────────────────────────────────────────────

test("sim 16. texto SBPE menciona parcela constante + abre SAC", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /constante/i);
    assert.match(r.text, /SAC/);
  }
});

test("sim 17. texto SAC menciona começa-termina + abre SBPE", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, sistema: "sac", price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /começa em/i);
    assert.match(r.text, /termina em/i);
    assert.match(r.text, /SBPE/);
  }
});

test("sim 18. texto mostra taxa com vírgula decimal pt-BR", () => {
  const r = computeSimulationResponse(
    {
      preco_imovel: 400_000,
      taxa_anual: 0.115,
      price_source: "lead",
    },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /11,50%/);
  }
});

test("sim 19. price_source=empreendimento inclui 'a partir de'", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 480_000, price_source: "empreendimento" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /a partir de/i);
  }
});

test("sim 20. price_source=lead NÃO cola 'a partir de'", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 480_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.doesNotMatch(r.text, /a partir de/i);
  }
});

test("sim 21. nome personaliza o texto", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead", nome: "Carlos" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /Carlos/);
  }
});

test("sim 22. texto inclui ressalva de custos extras", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /condomínio|IPTU|taxas/i);
  }
});

test("sim 23. texto converte prazo_meses em anos", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, prazo_meses: 240, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /20 anos/);
  }
});

test("sim 24. texto inclui percentual da entrada (20%)", () => {
  const r = computeSimulationResponse(
    { preco_imovel: 400_000, price_source: "lead" },
    FLAGS_ON,
    DEFAULTS,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /20%/);
  }
});
