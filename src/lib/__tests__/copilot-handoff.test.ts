/**
 * Unit tests de copilot-handoff (Track 3 · Slice 3.6a).
 *
 * Só a parte pura — `shouldCreateHandoffForSuggestion`. O wrapper
 * async `ensureHandoffForSuggestion` toca Supabase + Evolution e
 * cai sob integration, não unit.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldCreateHandoffForSuggestion,
  type LeadHandoffState,
} from "../copilot-handoff.ts";

// Note: `ensureHandoffForSuggestion` (o wrapper com DB) foi inlined em
// `copilot-suggestions.ts` como `maybeTriggerHandoffForSuggestion`.
// Este arquivo testa só a parte pura — o wrapper cai em integration.

// Factory — explicita os defaults e deixa cada teste variar só o que importa.
function state(overrides: Partial<LeadHandoffState> = {}): LeadHandoffState {
  return {
    bridge_active: false,
    human_takeover: false,
    handoff_notified_at: null,
    handoff_resolved_at: null,
    ...overrides,
  };
}

test("handoff 1. lead limpo (sem ponte, sem takeover, sem handoff) → cria", () => {
  assert.equal(shouldCreateHandoffForSuggestion(state()), true);
});

test("handoff 2. bridge_active=true → NÃO cria (corretor já em ponte)", () => {
  assert.equal(
    shouldCreateHandoffForSuggestion(state({ bridge_active: true })),
    false,
  );
});

test("handoff 3. human_takeover=true → NÃO cria (corretor assumiu manual)", () => {
  assert.equal(
    shouldCreateHandoffForSuggestion(state({ human_takeover: true })),
    false,
  );
});

test("handoff 4. handoff pending (notified sem resolved) → NÃO cria (duplicaria)", () => {
  assert.equal(
    shouldCreateHandoffForSuggestion(
      state({ handoff_notified_at: "2026-04-21T10:00:00Z" }),
    ),
    false,
  );
});

test("handoff 5. handoff ciclo anterior fechado → cria (novo fire legítimo)", () => {
  assert.equal(
    shouldCreateHandoffForSuggestion(
      state({
        handoff_notified_at: "2026-04-21T09:00:00Z",
        handoff_resolved_at: "2026-04-21T09:30:00Z",
      }),
    ),
    true,
  );
});

test("handoff 6. bridge_active supera resolved (corretor ainda em ponte) → NÃO cria", () => {
  // Defesa belt-and-suspenders: mesmo com o handoff resolvido, se por
  // algum motivo a bridge continua ativa, sugestão dupla seria ruído.
  assert.equal(
    shouldCreateHandoffForSuggestion(
      state({
        bridge_active: true,
        handoff_notified_at: "2026-04-21T09:00:00Z",
        handoff_resolved_at: "2026-04-21T09:30:00Z",
      }),
    ),
    false,
  );
});

test("handoff 7. null em todos os campos (lead recém-criado) → cria", () => {
  assert.equal(
    shouldCreateHandoffForSuggestion({
      bridge_active: null,
      human_takeover: null,
      handoff_notified_at: null,
      handoff_resolved_at: null,
    }),
    true,
  );
});

test("handoff 8. determinismo — mesmo input = mesmo output", () => {
  const s = state({ handoff_notified_at: "2026-04-21T10:00:00Z" });
  assert.equal(
    shouldCreateHandoffForSuggestion(s),
    shouldCreateHandoffForSuggestion(s),
  );
});
