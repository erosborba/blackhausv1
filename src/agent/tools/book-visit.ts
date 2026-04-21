import { supabaseAdmin } from "@/lib/supabase";
import { createVisit, type Visit } from "@/lib/visits";
import { sendText } from "@/lib/evolution";
import { emitLeadEvent } from "@/lib/lead-events";
import {
  allocateSlots,
  formatSlotPtBR,
  type AvailabilityWindow,
  type BusyVisit,
} from "@/lib/slot-allocator";

/**
 * Agent tool: book_visit v2 — Track 2 · Slice 2.5.
 *
 * Evolução do `schedule_visit` antigo. Em vez de só gravar a row, agora:
 *   1. Valida que o slot ainda está disponível (anti-double-book)
 *   2. Cria a visit em `visits` (com agent_id resolvido)
 *   3. Emite `lead_events` (visit_scheduled + flag post_handoff se
 *      handoff_notified_at já existe)
 *   4. Envia confirmação WhatsApp pro lead
 *
 * Não integra com Google Calendar (slice 2.3, pendente de OAuth) — o
 * calendar write-through se hook-a em cima disso via lead_events ou
 * direto no createVisit.
 *
 * O `schedule_visit` antigo fica disponível em `schedule-visit.ts` como
 * fallback "dumb write" pra UI manual (corretor clica "marquei no
 * papel" e só registra).
 */

export type BookVisitInput = {
  lead_id: string;
  lead_phone: string; // E.164 sem "+"
  agent_id: string;
  scheduled_at: string; // ISO UTC
  empreendimento_id?: string | null;
  unidade_id?: string | null;
  duration_min?: number;
  notes?: string | null;
  /** Quem está pedindo? 'bia' (default) | 'corretor:<id>' | 'lead'. */
  created_by?: string | null;
  /** Se true, pula o envio de WhatsApp (útil pra testes e eval). */
  skip_whatsapp?: boolean;
};

export type BookVisitOutput = {
  ok: boolean;
  reason?:
    | "invalid_date"
    | "past_date"
    | "slot_taken"
    | "agent_unavailable"
    | "insert_failed"
    | "whatsapp_failed";
  visit_id?: string;
  /** Texto da confirmação que foi (ou seria) enviada. */
  confirmation_text: string;
  /** True se o lead havia sido escalado antes (sinal pra analytics). */
  was_post_handoff?: boolean;
};

const DEFAULT_DURATION_MIN = 60;

export async function bookVisit(input: BookVisitInput): Promise<BookVisitOutput> {
  const durMin = input.duration_min ?? DEFAULT_DURATION_MIN;

  // 0. Valida a data
  const when = new Date(input.scheduled_at);
  if (!Number.isFinite(when.getTime())) {
    return {
      ok: false,
      reason: "invalid_date",
      confirmation_text: "Não consegui entender a data. Pode me mandar dia/mês e hora?",
    };
  }
  if (when.getTime() < Date.now() - 60_000) {
    return {
      ok: false,
      reason: "past_date",
      confirmation_text: "Essa data já passou. Me manda uma data futura?",
    };
  }

  const sb = supabaseAdmin();

  // 1. Anti-double-book: re-roda allocator pra esse agent + horário.
  //    Se o slot não aparece como livre, rejeita.
  const available = await isSlotAvailable({
    agent_id: input.agent_id,
    at: input.scheduled_at,
    duration_min: durMin,
  });
  if (!available.ok) {
    return {
      ok: false,
      reason: available.reason,
      confirmation_text: available.reason === "slot_taken"
        ? "Esse horário acabou de ser pego. Posso te oferecer outros?"
        : "Esse corretor não está com agenda aberta pra esse horário. Vou ver outra opção.",
    };
  }

  // 2. Cria a visit.
  const visit = await createVisit({
    lead_id: input.lead_id,
    agent_id: input.agent_id,
    empreendimento_id: input.empreendimento_id ?? null,
    unidade_id: input.unidade_id ?? null,
    scheduled_at: when.toISOString(),
    notes: input.notes ?? null,
    created_by: input.created_by ?? "bia",
  });
  if (!visit) {
    return {
      ok: false,
      reason: "insert_failed",
      confirmation_text:
        "Deu um ruído aqui do meu lado. Vou pedir pro corretor entrar em contato pra confirmar.",
    };
  }

  // 3. Verifica se é post-handoff pra sinalizar (analytics de retomada
  //    de lead após o corretor não ter fechado).
  const { data: leadRow } = await sb
    .from("leads")
    .select("handoff_notified_at, handoff_resolved_at")
    .eq("id", input.lead_id)
    .maybeSingle();
  const wasPostHandoff = Boolean(
    (leadRow as { handoff_notified_at?: string | null } | null)?.handoff_notified_at,
  );
  if (wasPostHandoff) {
    void emitLeadEvent({
      leadId: input.lead_id,
      kind: "note_added",
      payload: {
        sub: "visit_scheduled_post_handoff",
        visit_id: visit.id,
        scheduled_at: visit.scheduled_at,
        handoff_notified_at: (leadRow as { handoff_notified_at?: string | null } | null)?.handoff_notified_at,
      },
      actor: input.created_by ?? "bia",
    });
  }

  // 4. Manda confirmação WhatsApp (a menos que explicitamente pulado).
  const empNome = await maybeGetEmpreendimentoNome(visit);
  const confirmation = formatConfirmation(visit, empNome);
  let whatsappErr: string | null = null;
  if (!input.skip_whatsapp) {
    try {
      await sendText({ to: input.lead_phone, text: confirmation, delayMs: 800 });
    } catch (e) {
      whatsappErr = e instanceof Error ? e.message : String(e);
      console.error("[book-visit] whatsapp confirmation failed:", whatsappErr);
      // Não desfazemos a visit — ela está marcada, o envio pode ser
      // re-tentado via UI / lembrete 24h (Slice 2.6).
    }
  }

  return {
    ok: true,
    visit_id: visit.id,
    confirmation_text: confirmation,
    was_post_handoff: wasPostHandoff,
    ...(whatsappErr ? { reason: "whatsapp_failed" as const } : {}),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

async function isSlotAvailable(args: {
  agent_id: string;
  at: string;
  duration_min: number;
}): Promise<{ ok: true } | { ok: false; reason: "slot_taken" | "agent_unavailable" }> {
  const sb = supabaseAdmin();
  const { data: availRows } = await sb
    .from("agent_availability")
    .select("agent_id, weekday, start_minute, end_minute, timezone")
    .eq("agent_id", args.agent_id)
    .eq("active", true);
  const windows = (availRows ?? []) as AvailabilityWindow[];
  if (windows.length === 0) return { ok: false, reason: "agent_unavailable" };

  // Busca busy no mesmo dia pra checar overlap.
  const at = new Date(args.at);
  const dayStart = new Date(at);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 2 * 86_400_000);
  const { data: visitRows } = await sb
    .from("visits")
    .select("agent_id, scheduled_at")
    .eq("agent_id", args.agent_id)
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString());
  const busy: BusyVisit[] = ((visitRows ?? []) as BusyVisit[]);

  // Usa o allocator com janela estreita centrada no horário pedido pra
  // testar se esse slot específico apareceria como livre.
  const nowIso = new Date(at.getTime() - 3 * 60 * 60_000).toISOString(); // 3h antes pra bypass minLeadTime
  const slots = allocateSlots({
    windows,
    busy,
    now: nowIso,
    slotStepMin: 15, // fino o bastante pra o horário cair num step
    visitDurationMin: args.duration_min,
    horizonDays: 1,
    bufferMin: 15,
    minLeadTimeMin: 0,
    maxSlots: 200,
  });
  const target = at.getTime();
  const EPS_MS = 60_000;
  const hit = slots.find(
    (s) => Math.abs(new Date(s.start_at).getTime() - target) < EPS_MS,
  );
  if (!hit) return { ok: false, reason: "slot_taken" };
  return { ok: true };
}

async function maybeGetEmpreendimentoNome(visit: Visit): Promise<string | null> {
  if (!visit.empreendimento_id) return null;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("empreendimentos")
    .select("nome")
    .eq("id", visit.empreendimento_id)
    .maybeSingle();
  return (data as { nome: string } | null)?.nome ?? null;
}

function formatConfirmation(visit: Visit, empNome: string | null): string {
  const slotLike = {
    agent_id: visit.agent_id ?? "",
    start_at: visit.scheduled_at,
    minute_of_day: 0,
    weekday: 0,
    local_date: "",
    timezone: "America/Sao_Paulo",
  };
  const when = formatSlotPtBR(slotLike);
  const loc = empNome ? ` em ${empNome}` : "";
  return (
    `Visita confirmada pra ${when}${loc}. ` +
    `Te mando um lembrete 24h antes. Se precisar remarcar, é só me avisar.`
  );
}
