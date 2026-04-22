/**
 * Unit tests do gerador ICS (Track 2 · Slice 2.2').
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, icsToBase64 } from "../ics.ts";

test("ics 1. evento básico tem todas as linhas obrigatórias + CRLF", () => {
  const out = buildIcs({
    uid: "visit-123@lumihaus",
    startAt: "2026-05-10T14:00:00.000Z",
    durationMin: 60,
    summary: "Visita - Jardim das Acácias",
    _now: new Date("2026-05-01T00:00:00.000Z"),
  });

  // CRLF entre linhas
  assert.ok(out.includes("\r\n"), "deve ter CRLF");
  assert.ok(!out.includes("\n\r"), "não deve ter \\n\\r");
  // Cabeçalhos obrigatórios
  assert.match(out, /BEGIN:VCALENDAR\r\n/);
  assert.match(out, /VERSION:2\.0\r\n/);
  assert.match(out, /PRODID:-\/\/Lumihaus/);
  assert.match(out, /BEGIN:VEVENT/);
  assert.match(out, /END:VEVENT/);
  assert.match(out, /END:VCALENDAR/);
  // UID + DTSTART em UTC compact
  assert.match(out, /UID:visit-123@lumihaus/);
  assert.match(out, /DTSTART:20260510T140000Z/);
  assert.match(out, /DTEND:20260510T150000Z/);
});

test("ics 2. summary com vírgula/ponto-e-vírgula é escapado", () => {
  const out = buildIcs({
    uid: "u-1",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "Visita, Ed. Orion; 14h",
  });
  // RFC 5545: vírgula vira \, ponto-e-vírgula vira \;
  assert.match(out, /SUMMARY:Visita\\, Ed\. Orion\\; 14h/);
});

test("ics 3. description com newline vira \\n literal", () => {
  const out = buildIcs({
    uid: "u-2",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "x",
    description: "Linha 1\nLinha 2",
  });
  assert.match(out, /DESCRIPTION:Linha 1\\nLinha 2/);
});

test("ics 4. durationMin default é 60min se não passar endAt", () => {
  const out = buildIcs({
    uid: "u-3",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "x",
  });
  assert.match(out, /DTSTART:20260510T140000Z/);
  assert.match(out, /DTEND:20260510T150000Z/);
});

test("ics 5. endAt explícito sobrepõe durationMin", () => {
  const out = buildIcs({
    uid: "u-4",
    startAt: "2026-05-10T14:00:00.000Z",
    endAt: "2026-05-10T16:30:00.000Z",
    durationMin: 60, // ignorado
    summary: "x",
  });
  assert.match(out, /DTEND:20260510T163000Z/);
});

test("ics 6. SEQUENCE padrão é 0; reagendamento passa > 0", () => {
  const v0 = buildIcs({
    uid: "u-5",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "x",
  });
  assert.match(v0, /SEQUENCE:0/);

  const v1 = buildIcs({
    uid: "u-5",
    startAt: "2026-05-11T15:00:00.000Z",
    summary: "x",
    sequence: 1,
    method: "REQUEST",
  });
  assert.match(v1, /SEQUENCE:1/);
  assert.match(v1, /METHOD:REQUEST/);
});

test("ics 7. organizer + attendee com CN renderizados", () => {
  const out = buildIcs({
    uid: "u-6",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "x",
    organizerEmail: "bia@lumihaus.im",
    organizerName: "Bia",
    attendeeEmail: "eros@lumihaus.im",
    attendeeName: "Eros Borba",
  });
  assert.match(out, /ORGANIZER;CN=Bia:mailto:bia@lumihaus\.im/);
  assert.match(out, /ATTENDEE;CN=Eros Borba;RSVP=TRUE/);
});

test("ics 8. VALARM 1h antes é incluído por default", () => {
  const out = buildIcs({
    uid: "u-7",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "x",
  });
  assert.match(out, /BEGIN:VALARM/);
  assert.match(out, /TRIGGER:-PT1H/);
  assert.match(out, /END:VALARM/);
});

test("ics 9. linhas > 75 chars fazem folding com CRLF + espaço", () => {
  const longDesc = "a".repeat(200);
  const out = buildIcs({
    uid: "u-8",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "x",
    description: longDesc,
  });
  // Deve ter pelo menos um "\r\n " (continuation line) gerado pelo folding.
  assert.ok(out.includes("\r\n "), "esperado folding de linha longa");
});

test("ics 10. base64 do output é decodable", () => {
  const ics = buildIcs({
    uid: "u-9",
    startAt: "2026-05-10T14:00:00.000Z",
    summary: "olá acentos",
  });
  const b64 = icsToBase64(ics);
  const back = Buffer.from(b64, "base64").toString("utf-8");
  assert.equal(back, ics);
  assert.match(back, /SUMMARY:olá acentos/);
});
