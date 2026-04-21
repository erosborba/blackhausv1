/**
 * Unit tests do slot allocator (Track 2 · Slice 2.1).
 *
 *   npm run test:unit
 *
 * Rodados via `node --test --experimental-strip-types` (Node >= 22).
 * 10 casos cobrindo: weekday match, step, lead time, busy overlap,
 * multi-agent, horizonte, timezone, DST-fake, cap, vazio.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSlots,
  formatSlotPtBR,
  type AvailabilityWindow,
  type BusyVisit,
} from "../slot-allocator.ts";

// Helpers pra testes
const AGENT_A = "00000000-0000-0000-0000-000000000001";
const AGENT_B = "00000000-0000-0000-0000-000000000002";
const TZ_SP = "America/Sao_Paulo";

function win(
  agent_id: string,
  weekday: number,
  start_h: number,
  end_h: number,
  timezone = TZ_SP,
): AvailabilityWindow {
  return {
    agent_id,
    weekday,
    start_minute: start_h * 60,
    end_minute: end_h * 60,
    timezone,
  };
}

// Segunda-feira 2026-04-20 12:00 BRT (= 15:00 UTC). Weekday = 1.
const NOW = "2026-04-20T15:00:00.000Z";

test("1. janela no weekday certo gera slots no step", () => {
  const windows = [win(AGENT_A, 2, 9, 12)]; // terça 9-12 (weekday 2)
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW,
    slotStepMin: 60,
    minLeadTimeMin: 0,
  });
  // Terça 21/abr 9h, 10h, 11h = 3 slots (12h não entra — fim exclusivo, precisa de 60min duração).
  assert.equal(slots.length, 3);
  assert.equal(slots[0].weekday, 2);
  assert.equal(slots[0].minute_of_day, 540); // 9h
  assert.equal(slots[2].minute_of_day, 660); // 11h
});

test("2. step de 30min gera 2x mais slots", () => {
  const windows = [win(AGENT_A, 2, 9, 12)];
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW,
    slotStepMin: 30,
    visitDurationMin: 30,
    minLeadTimeMin: 0,
  });
  // 9:00, 9:30, 10:00, 10:30, 11:00, 11:30 — 6 slots com duração 30min.
  assert.equal(slots.length, 6);
});

test("3. minLeadTimeMin exclui slots muito próximos do agora", () => {
  // Segunda é weekday 1. Janela seg 13-18. Agora é seg 12h BRT (15:00Z).
  const windows = [win(AGENT_A, 1, 13, 18)];
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW, // 12h BRT segunda
    slotStepMin: 60,
    horizonDays: 0, // só hoje, senão pega as próximas segundas também
    minLeadTimeMin: 180, // 3h lead time → exclui slots antes das 15h BRT
  });
  // 13h e 14h excluídos; 15h, 16h, 17h passam = 3 slots
  assert.equal(slots.length, 3);
  assert.equal(slots[0].minute_of_day, 15 * 60);
});

test("4. visita busy conflita com o slot do mesmo corretor", () => {
  const windows = [win(AGENT_A, 2, 9, 12)];
  // Busy em terça 10:00 BRT = 13:00 UTC
  const busy: BusyVisit[] = [
    { agent_id: AGENT_A, scheduled_at: "2026-04-21T13:00:00.000Z" },
  ];
  const slots = allocateSlots({
    windows,
    busy,
    now: NOW,
    slotStepMin: 60,
    visitDurationMin: 60,
    minLeadTimeMin: 0,
  });
  // Slots: 9h, 10h, 11h. 10h conflita diretamente. 9h não (termina 10h == busy.start).
  // 11h não (busy termina 11h == slot.start).
  // Então sobram 9h e 11h = 2 slots.
  assert.equal(slots.length, 2);
  assert.ok(!slots.some((s) => s.minute_of_day === 600));
});

test("5. buffer derruba slots adjacentes ao busy", () => {
  // Busy dura 60min + 15min buffer cada lado = ocupa efetivamente 90min.
  // Em janela 9-12 com busy às 10h, nenhum slot de 60min sobra:
  //   9h  (9:00-10:00)  → conflita com bufferPre do busy (09:45-10:00)
  //   10h (10:00-11:00) → conflita direto
  //   11h (11:00-12:00) → conflita com bufferPost do busy (11:00-11:15)
  const windows = [win(AGENT_A, 2, 9, 12)];
  const busy: BusyVisit[] = [
    { agent_id: AGENT_A, scheduled_at: "2026-04-21T13:00:00.000Z" }, // 10h BRT terça
  ];
  const slots = allocateSlots({
    windows,
    busy,
    now: NOW,
    slotStepMin: 60,
    visitDurationMin: 60,
    bufferMin: 15,
    horizonDays: 1,
    minLeadTimeMin: 0,
  });
  assert.equal(slots.length, 0);

  // Sanity check: sem buffer, o 11h deve sobreviver (termina quando busy começa, sem overlap).
  const noBuffer = allocateSlots({
    windows,
    busy,
    now: NOW,
    slotStepMin: 60,
    visitDurationMin: 60,
    bufferMin: 0,
    horizonDays: 1,
    minLeadTimeMin: 0,
  });
  assert.equal(noBuffer.length, 2);
  assert.deepEqual(
    noBuffer.map((s) => s.minute_of_day).sort((a, b) => a - b),
    [9 * 60, 11 * 60],
  );
});

test("6. busy de outro corretor não afeta o slot deste", () => {
  const windows = [win(AGENT_A, 2, 9, 11), win(AGENT_B, 2, 9, 11)];
  const busy: BusyVisit[] = [
    { agent_id: AGENT_B, scheduled_at: "2026-04-21T12:00:00.000Z" }, // 9h BRT, corretor B
  ];
  const slots = allocateSlots({
    windows,
    busy,
    now: NOW,
    slotStepMin: 60,
    visitDurationMin: 60,
    minLeadTimeMin: 0,
  });
  // A: 9h e 10h. B: só 10h (9h conflita com busy). Total 3.
  assert.equal(slots.length, 3);
  const agentA = slots.filter((s) => s.agent_id === AGENT_A);
  assert.equal(agentA.length, 2);
});

test("7. horizonDays=0 só gera slots do mesmo dia (hoje)", () => {
  // weekday 1 = segunda. NOW = seg 12h BRT. Janela seg 14-17.
  const windows = [win(AGENT_A, 1, 14, 17)];
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW,
    slotStepMin: 60,
    horizonDays: 0,
    minLeadTimeMin: 0,
  });
  // 14h, 15h, 16h = 3 slots.
  assert.equal(slots.length, 3);
});

test("8. weekday que não bate na janela retorna vazio", () => {
  // Janela só sábado (6). NOW é segunda. Horizonte 4 dias = até sexta.
  const windows = [win(AGENT_A, 6, 9, 17)];
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW,
    horizonDays: 4, // seg→sex, não inclui sáb
    minLeadTimeMin: 0,
  });
  assert.equal(slots.length, 0);
});

test("9. timezone diferente desloca os slots corretamente", () => {
  // Janela em NYC (-4 no verão, -5 no inverno). 20/04/2026 = EDT (-04:00).
  const windows = [win(AGENT_A, 2, 9, 10, "America/New_York")];
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW,
    slotStepMin: 60,
    visitDurationMin: 60,
    minLeadTimeMin: 0,
  });
  assert.equal(slots.length, 1);
  // terça 9h EDT = 13:00 UTC
  assert.equal(slots[0].start_at, "2026-04-21T13:00:00.000Z");
  assert.equal(slots[0].local_date, "2026-04-21");
});

test("10. maxSlots limita a saída", () => {
  const windows = [win(AGENT_A, 1, 0, 24), win(AGENT_A, 2, 0, 24), win(AGENT_A, 3, 0, 24)];
  const slots = allocateSlots({
    windows,
    busy: [],
    now: NOW,
    slotStepMin: 60,
    maxSlots: 5,
    minLeadTimeMin: 0,
  });
  assert.equal(slots.length, 5);
  // Ordenados por start_at asc
  for (let i = 1; i < slots.length; i++) {
    assert.ok(slots[i - 1].start_at <= slots[i].start_at);
  }
});

test("11. input inválido em now lança erro explícito", () => {
  assert.throws(
    () => allocateSlots({ windows: [], busy: [], now: "não-é-data" }),
    /now inválido/,
  );
});

test("12. formatSlotPtBR produz string legível", () => {
  const slot = {
    agent_id: AGENT_A,
    start_at: "2026-04-24T17:00:00.000Z", // sex 14h BRT
    minute_of_day: 14 * 60,
    weekday: 5,
    local_date: "2026-04-24",
    timezone: TZ_SP,
  };
  const out = formatSlotPtBR(slot);
  // Espera algo como "sex, 24/abr às 14h"
  assert.match(out, /sex/i);
  assert.match(out, /24/);
  assert.match(out, /abr/i);
  assert.match(out, /14h/);
});
