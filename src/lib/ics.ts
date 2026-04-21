/**
 * Gerador de iCalendar (RFC 5545) — Track 2 · Slice 2.2'.
 *
 * Substitui a integração com Google Calendar OAuth. Em vez de a gente
 * escrever no calendar do corretor via API, gera um `.ics` anexado à
 * confirmação WhatsApp (via `sendDocument`). Lead e corretor tocam no
 * arquivo e o evento entra no calendar nativo do celular deles.
 *
 * Função pura, zero I/O, unit-testável. Formato mínimo válido:
 *   BEGIN:VCALENDAR
 *   VERSION:2.0
 *   PRODID:-//Blackhaus//Bia//PT
 *   BEGIN:VEVENT
 *   UID:<stable>
 *   DTSTAMP:<now UTC>
 *   DTSTART:<UTC>
 *   DTEND:<UTC>
 *   SUMMARY:...
 *   DESCRIPTION:...
 *   LOCATION:...
 *   END:VEVENT
 *   END:VCALENDAR
 *
 * Notas de compatibilidade:
 *   - Datas em UTC com sufixo Z (forma mais portável; Apple/Google/Outlook
 *     aceitam sem TZID).
 *   - CRLF entre linhas (RFC manda; vários parsers reclamam sem).
 *   - Text fields escapados (vírgula, ponto-e-vírgula, barra, newline).
 *   - Line folding em 75 chars (parsers estritos do Apple quebram sem).
 */

export type IcsEvent = {
  uid: string;                // id estável — reagendamento preserva pra update-in-place
  startAt: string | Date;     // UTC ISO ou Date
  durationMin?: number;       // default 60
  endAt?: string | Date;      // alternativa a durationMin
  summary: string;
  description?: string;
  location?: string;
  organizerEmail?: string;    // opcional, ex: "bia@blackhaus.im"
  organizerName?: string;
  attendeeEmail?: string;     // corretor
  attendeeName?: string;
  method?: "PUBLISH" | "REQUEST"; // REQUEST = convite real; PUBLISH = info
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  sequence?: number;          // incrementa em reagendamentos
  /** Injetável pra testes; default new Date(). */
  _now?: Date;
};

/**
 * Gera o conteúdo `.ics` como string. Sem I/O — caller encoda em base64
 * e manda pra sendDocument.
 */
export function buildIcs(event: IcsEvent): string {
  const start = toDate(event.startAt);
  const end = event.endAt
    ? toDate(event.endAt)
    : new Date(start.getTime() + (event.durationMin ?? 60) * 60_000);
  const now = event.sequence !== undefined ? undefined : event._now ?? new Date();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Blackhaus//Bia//PT",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.method ?? "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(event._now ?? now ?? new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `STATUS:${event.status ?? "CONFIRMED"}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);

  if (event.organizerEmail) {
    const cn = event.organizerName ? `;CN=${escapeText(event.organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }
  if (event.attendeeEmail) {
    const cn = event.attendeeName ? `;CN=${escapeText(event.attendeeName)}` : "";
    lines.push(
      `ATTENDEE${cn};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${event.attendeeEmail}`,
    );
  }

  // VALARM: lembrete 1h antes dentro do próprio calendar (independente
  // do nosso cron de WhatsApp; belt-and-suspenders).
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT1H",
    "DESCRIPTION:Lembrete",
    "END:VALARM",
  );

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Converte pra UTC no formato YYYYMMDDTHHMMSSZ (compact ICS). */
function toIcsDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Escape per RFC 5545 §3.3.11:
 *   \\ → \\\\   ;  ;  →  \\;   ,  →  \\,   NL → \\n
 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Line folding RFC 5545 §3.1: linhas > 75 octets são quebradas em
 * continuations (" " no começo da próxima). Na prática 75 chars é suficiente
 * pro nosso texto ASCII/UTF-8 simples.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
    chunks.push(chunk);
    i += chunk.length;
  }
  return chunks.join("\r\n ");
}

/** Converte string → base64 (node Buffer). Wrapper pra testabilidade. */
export function icsToBase64(ics: string): string {
  return Buffer.from(ics, "utf-8").toString("base64");
}
