/**
 * Slot allocator — Track 2 · Slice 2.1.
 *
 * Dado: (a) janelas semanais de disponibilidade dos corretores ativos,
 * (b) visitas já marcadas (que bloqueiam o slot + `VISIT_DURATION_MIN`
 * de buffer), (c) data/hora atual, (d) horizonte em dias —
 * devolve slots livres ordenados por data crescente.
 *
 * **Função pura**: zero I/O, zero Date.now() interno (clock injetado),
 * zero timezone magic (parâmetros explícitos). Permite testes
 * determinísticos sem mock de relógio.
 *
 * Invariants: I-6 (função pura, determinística), I-2 (só opera sobre
 * dados reais — caller é responsável por filtrar test phones).
 *
 * Timezone handling: as janelas têm `timezone` próprio (default
 * `America/Sao_Paulo`). Convertemos a data-parede do timezone pra UTC
 * usando o offset em cada momento (DST-aware pra timezones que fazem;
 * Brasil não faz mais DST desde 2019).
 */

export type AvailabilityWindow = {
  agent_id: string;
  /** 0 = domingo, 6 = sábado (Date#getDay). */
  weekday: number;
  /** Minutos desde 00:00 no `timezone`. Ex: 540 = 09:00. */
  start_minute: number;
  /** Exclusivo. Ex: 1080 = 18:00. */
  end_minute: number;
  timezone: string;
};

export type BusyVisit = {
  agent_id: string;
  /** ISO timestamp UTC. */
  scheduled_at: string;
};

export type Slot = {
  agent_id: string;
  /** ISO timestamp UTC. */
  start_at: string;
  /** Minutos dentro do dia no timezone da janela (debug/UI). */
  minute_of_day: number;
  /** 0–6. */
  weekday: number;
  /** Data-parede no timezone da janela (ex: "2026-04-22"). */
  local_date: string;
  timezone: string;
};

export type AllocateInput = {
  windows: AvailabilityWindow[];
  busy: BusyVisit[];
  /** Minutos entre slots propostos (granularidade). Default 60. */
  slotStepMin?: number;
  /** Duração da visita pra detectar overlap. Default 60. */
  visitDurationMin?: number;
  /** Buffer antes/depois da visita busy. Default 0. */
  bufferMin?: number;
  /** "Agora" (ISO UTC). Slots antes disso + `minLeadTimeMin` não aparecem. */
  now: string;
  /** Horizonte em dias (inclusive). Default 7. */
  horizonDays?: number;
  /** Minutos mínimos entre `now` e o slot proposto. Default 120 (2h). */
  minLeadTimeMin?: number;
  /** Cap de slots retornados pra não estourar resposta. Default 50. */
  maxSlots?: number;
};

export const SLOT_STEP_MIN_DEFAULT = 60;
export const VISIT_DURATION_MIN_DEFAULT = 60;
export const HORIZON_DAYS_DEFAULT = 7;
export const MIN_LEAD_TIME_MIN_DEFAULT = 120;

/**
 * Retorna slots livres, ordenados por start_at asc.
 * Se `windows` vazia OU todos os corretores em busy, retorna [].
 */
export function allocateSlots(input: AllocateInput): Slot[] {
  const stepMin = input.slotStepMin ?? SLOT_STEP_MIN_DEFAULT;
  const durMin = input.visitDurationMin ?? VISIT_DURATION_MIN_DEFAULT;
  const buffer = input.bufferMin ?? 0;
  const horizonDays = input.horizonDays ?? HORIZON_DAYS_DEFAULT;
  const minLead = input.minLeadTimeMin ?? MIN_LEAD_TIME_MIN_DEFAULT;
  const maxSlots = input.maxSlots ?? 50;

  const nowMs = new Date(input.now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error(`slot-allocator: now inválido: ${input.now}`);
  }
  const earliestMs = nowMs + minLead * 60_000;

  // Pré-processa busy por agent pra lookup O(1) na checagem de overlap.
  const busyByAgent = new Map<string, number[]>();
  for (const b of input.busy) {
    const t = new Date(b.scheduled_at).getTime();
    if (!Number.isFinite(t)) continue;
    const arr = busyByAgent.get(b.agent_id) ?? [];
    arr.push(t);
    busyByAgent.set(b.agent_id, arr);
  }

  const out: Slot[] = [];

  // Para cada dia D no horizonte, para cada window ativa nesse weekday,
  // geramos slots [start, end) no step, filtramos lead time + busy.
  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
    const refMs = nowMs + dayOffset * 86_400_000;
    for (const w of input.windows) {
      const { localDate, weekday } = walldayInTz(refMs, w.timezone);
      if (weekday !== w.weekday) continue;
      for (let min = w.start_minute; min + durMin <= w.end_minute; min += stepMin) {
        const slotMs = wallMinutesToUTCMs(localDate, min, w.timezone);
        if (!Number.isFinite(slotMs)) continue;
        if (slotMs < earliestMs) continue;
        if (conflictsWithBusy(slotMs, durMin, buffer, busyByAgent.get(w.agent_id))) continue;
        out.push({
          agent_id: w.agent_id,
          start_at: new Date(slotMs).toISOString(),
          minute_of_day: min,
          weekday: w.weekday,
          local_date: localDate,
          timezone: w.timezone,
        });
        if (out.length >= maxSlots * 2) break; // cap defensivo antes de sort
      }
    }
  }

  out.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return out.slice(0, maxSlots);
}

function conflictsWithBusy(
  slotMs: number,
  durMin: number,
  bufferMin: number,
  busy: number[] | undefined,
): boolean {
  if (!busy || busy.length === 0) return false;
  const slotEnd = slotMs + durMin * 60_000;
  const slotStart = slotMs - bufferMin * 60_000;
  for (const bMs of busy) {
    const bEnd = bMs + durMin * 60_000 + bufferMin * 60_000;
    const bStart = bMs - bufferMin * 60_000;
    // overlap clássico [a.start, a.end) vs [b.start, b.end)
    if (slotStart < bEnd && bStart < slotEnd) return true;
  }
  return false;
}

/**
 * Converte um instante UTC pra (data local, weekday) no timezone dado.
 * Usa `Intl.DateTimeFormat` que já lida com DST (no Brasil não tem mais,
 * mas o mesmo código funciona pra qualquer TZ).
 */
function walldayInTz(utcMs: number, tz: string): { localDate: string; weekday: number } {
  const d = new Date(utcMs);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const wkName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = WEEKDAY_BY_NAME[wkName] ?? 0;
  return { localDate: `${y}-${m}-${day}`, weekday };
}

const WEEKDAY_BY_NAME: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Converte (data-parede YYYY-MM-DD + minuto_do_dia) no timezone → ms UTC.
 *
 * Estratégia: cria um Date assumindo UTC, mede o offset do timezone
 * naquele instante via Intl, subtrai. Faz 2 iterações pra ajustar DST
 * boundary (raro no Brasil pós-2019, mas safe pra outros TZs).
 */
function wallMinutesToUTCMs(localDate: string, minuteOfDay: number, tz: string): number {
  const [yStr, mStr, dStr] = localDate.split("-");
  const y = Number(yStr);
  const mo = Number(mStr) - 1;
  const d = Number(dStr);
  const h = Math.floor(minuteOfDay / 60);
  const mi = minuteOfDay % 60;
  // Instante UTC "naive" (como se a parede fosse UTC)
  let utcMs = Date.UTC(y, mo, d, h, mi, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = tzOffsetMinutes(utcMs, tz);
    const nextMs = Date.UTC(y, mo, d, h, mi, 0) - offsetMin * 60_000;
    if (nextMs === utcMs) break;
    utcMs = nextMs;
  }
  return utcMs;
}

/**
 * Minutos de offset entre UTC e o timezone no instante dado.
 * Ex: São Paulo (BRT) = -180 min. NYC (EST) = -300; (EDT) = -240.
 */
function tzOffsetMinutes(utcMs: number, tz: string): number {
  const date = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let h = get("hour");
  if (h === 24) h = 0; // Intl às vezes retorna "24" em en-US — safety.
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"), get("second"));
  return Math.round((asIfUtc - utcMs) / 60_000);
}

/**
 * Formatação helper pro texto que a Bia manda no WhatsApp.
 * Ex: "sex, 25/abr às 14h"
 */
export function formatSlotPtBR(slot: Slot): string {
  const d = new Date(slot.start_at);
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: slot.timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Resultado default: "sex., 25 de abr., 14:00"
  const parts = fmt.formatToParts(d);
  const wk = parts.find((p) => p.type === "weekday")?.value?.replace(".", "") ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const mon = parts.find((p) => p.type === "month")?.value?.replace(".", "") ?? "";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "";
  return `${wk}, ${day}/${mon} às ${hh}h${mm !== "00" ? mm : ""}`;
}
