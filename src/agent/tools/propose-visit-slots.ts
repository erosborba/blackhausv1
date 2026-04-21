import { supabaseAdmin } from "@/lib/supabase";
import {
  allocateSlots,
  formatSlotPtBR,
  type AvailabilityWindow,
  type BusyVisit,
  type Slot,
} from "@/lib/slot-allocator";

/**
 * Agent tool: propose_visit_slots — Track 2 · Slice 2.4.
 *
 * Usa `agent_availability` + `visits` já marcadas pra gerar 3 slots
 * livres nos próximos 7 dias pro lead escolher. Retorna texto pronto
 * pra Bia colar no WhatsApp + array estruturado pro caller salvar
 * estado (ex: pendingSlot no agent state, pra `book_visit` depois
 * validar escolha).
 *
 * Estratégia de seleção dos 3 slots:
 *   1. Ordena todos os slots livres por (dia asc, hora asc)
 *   2. Pega o próximo slot de hoje/amanhã de manhã, um de tarde,
 *      e um alternativo em outro dia — dá variedade sem flood
 *   3. Se houver menos de 3 disponíveis, retorna só os que tiver
 *
 * Invariants: I-6 (allocator é puro), I-2 (exclui test phones via
 * filtro inline em `busy`).
 */

export type ProposeVisitSlotsInput = {
  /** Se setado, restringe a slots desse corretor. Caso contrário considera todos os ativos. */
  agent_id?: string | null;
  /** Minutos de duração esperada. Default 60. */
  duration_min?: number;
  /** Horizonte em dias. Default 7. */
  horizon_days?: number;
  /** "Agora" injetado (útil pra testes). Default Date.now(). */
  now?: Date;
};

export type ProposeVisitSlotsOutput = {
  ok: boolean;
  reason?: "no_availability" | "no_slots";
  /** Slots candidatos (até 3, selecionados com variedade). */
  slots?: Slot[];
  /** Todos os slots livres (até 50) — útil pro UI escolher outro. */
  all_slots?: Slot[];
  /** Texto pronto em PT-BR pra Bia colar. */
  text: string;
};

const MAX_PROPOSE = 3;
const HORIZON_DEFAULT = 7;
const DURATION_DEFAULT = 60;

export async function proposeVisitSlots(
  input: ProposeVisitSlotsInput = {},
): Promise<ProposeVisitSlotsOutput> {
  const sb = supabaseAdmin();
  const durMin = input.duration_min ?? DURATION_DEFAULT;
  const horizon = input.horizon_days ?? HORIZON_DEFAULT;
  const now = (input.now ?? new Date()).toISOString();

  // 1. Janelas de disponibilidade (filtra por agent se especificado).
  let availQ = sb
    .from("agent_availability")
    .select("agent_id, weekday, start_minute, end_minute, timezone")
    .eq("active", true);
  if (input.agent_id) availQ = availQ.eq("agent_id", input.agent_id);
  const { data: availRows, error: availErr } = await availQ;
  if (availErr) {
    console.error("[propose-visit-slots] availability:", availErr.message);
    return {
      ok: false,
      reason: "no_availability",
      text: "Vou pedir pro corretor te chamar pra combinar a visita direto.",
    };
  }
  const windows = (availRows ?? []) as AvailabilityWindow[];
  if (windows.length === 0) {
    return {
      ok: false,
      reason: "no_availability",
      text: "Preciso confirmar os horários disponíveis com o corretor primeiro. Já te retorno.",
    };
  }

  // 2. Visits já marcadas no horizonte (dos corretores relevantes).
  const agentIds = Array.from(new Set(windows.map((w) => w.agent_id)));
  const fromIso = now;
  const toIso = new Date(
    new Date(now).getTime() + (horizon + 1) * 86_400_000,
  ).toISOString();
  const { data: visitRows, error: visitErr } = await sb
    .from("visits")
    .select("agent_id, scheduled_at")
    .in("agent_id", agentIds)
    .in("status", ["scheduled", "confirmed"]) // ignore cancelled/done/no_show
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso);
  if (visitErr) {
    console.error("[propose-visit-slots] visits:", visitErr.message);
    // Conservador: se não conseguir ler, trata como "sem busy" (é melhor
    // sugerir horários livres e o `book_visit` validar na hora do que
    // falhar o tool).
  }
  const busy = ((visitRows ?? []) as Array<{
    agent_id: string | null;
    scheduled_at: string;
  }>)
    .filter((v): v is BusyVisit => !!v.agent_id && !!v.scheduled_at)
    .map((v) => ({ agent_id: v.agent_id, scheduled_at: v.scheduled_at }));

  // 3. Calcula slots livres.
  const all = allocateSlots({
    windows,
    busy,
    now,
    visitDurationMin: durMin,
    slotStepMin: 60,
    horizonDays: horizon,
    bufferMin: 15, // 15min entre visitas pra deslocamento
    minLeadTimeMin: 180, // 3h lead time (tempo de preparação + confirmação)
    maxSlots: 50,
  });
  if (all.length === 0) {
    return {
      ok: false,
      reason: "no_slots",
      text: "Minha agenda tá apertada nos próximos dias. Vou pedir pro corretor te chamar pra combinar.",
    };
  }

  // 4. Seleciona 3 com variedade (manhã/tarde/outro dia).
  const picked = pickVariedSlots(all, MAX_PROPOSE);

  return {
    ok: true,
    slots: picked,
    all_slots: all,
    text: formatProposalText(picked),
  };
}

/**
 * Escolhe até N slots com variedade: tenta pegar um de manhã, um de
 * tarde e um em outro dia. Fallback pros primeiros em caso de pouca
 * amplitude.
 */
function pickVariedSlots(all: Slot[], n: number): Slot[] {
  if (all.length <= n) return all;
  const morning = all.find((s) => s.minute_of_day < 12 * 60);
  const afternoon = all.find((s) => s.minute_of_day >= 12 * 60);
  const picked: Slot[] = [];
  if (morning) picked.push(morning);
  if (afternoon && afternoon !== morning) picked.push(afternoon);
  // Terceiro slot: próximo de data diferente dos já escolhidos.
  const dates = new Set(picked.map((p) => p.local_date));
  const otherDay = all.find((s) => !dates.has(s.local_date));
  if (otherDay) picked.push(otherDay);
  // Preenche com os primeiros não escolhidos se ainda faltar.
  for (const s of all) {
    if (picked.length >= n) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.slice(0, n).sort((a, b) => a.start_at.localeCompare(b.start_at));
}

function formatProposalText(slots: Slot[]): string {
  if (slots.length === 0) return "Sem horários por enquanto. Vou pedir pro corretor te chamar.";
  if (slots.length === 1) {
    return `Posso te receber ${formatSlotPtBR(slots[0])}. Combina?`;
  }
  const lines = slots.map((s, i) => `${i + 1}. ${formatSlotPtBR(s)}`);
  return `Tenho esses horários livres pra visita:\n${lines.join("\n")}\n\nQual fica melhor pra você?`;
}
