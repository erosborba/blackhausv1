import { supabaseAdmin } from "@/lib/supabase";
import {
  updateVisitStatus,
  type Visit,
} from "@/lib/visits";
import { sendText, sendDocument } from "@/lib/evolution";
import { buildIcs, icsToBase64 } from "@/lib/ics";
import { formatSlotPtBR } from "@/lib/slot-allocator";

/**
 * Agent tools: reschedule_visit + cancel_visit — Track 2 · Slice 2.8.
 *
 * Complementa `book_visit` cobrindo o fluxo "não vou conseguir ir" e
 * "preciso mudar a data". Ambos:
 *   - Atualizam a row em `visits` (reschedule → mantém id + status=scheduled;
 *     cancel → status=cancelled + cancelled_reason)
 *   - Emitem `lead_events` (via lib/visits.ts)
 *   - Mandam confirmação pro lead
 *
 * Reschedule reusa `book_visit` pra re-validar o novo horário antes de
 * mudar a row (anti-double-book). Se o novo horário estiver tomado,
 * retorna erro sem mutar nada.
 */

export type RescheduleVisitInput = {
  visit_id: string;
  new_scheduled_at: string; // ISO UTC
  lead_phone: string;
  actor?: string | null;
  skip_whatsapp?: boolean;
};

export type RescheduleVisitOutput = {
  ok: boolean;
  reason?:
    | "visit_not_found"
    | "already_cancelled"
    | "past_visit"
    | "slot_taken"
    | "insert_failed"
    | "whatsapp_failed";
  visit_id?: string;
  text: string;
};

export async function rescheduleVisit(
  input: RescheduleVisitInput,
): Promise<RescheduleVisitOutput> {
  const sb = supabaseAdmin();
  const { data: current } = await sb
    .from("visits")
    .select("*")
    .eq("id", input.visit_id)
    .maybeSingle();
  if (!current) {
    return {
      ok: false,
      reason: "visit_not_found",
      text: "Não achei essa visita no meu registro. Pode me dizer qual empreendimento e data antiga?",
    };
  }
  const visit = current as Visit;
  if (visit.status === "cancelled" || visit.status === "no_show" || visit.status === "done") {
    return {
      ok: false,
      reason: "already_cancelled",
      text: `Essa visita já está ${visit.status}. Se quiser marcar uma nova, é só me avisar.`,
    };
  }

  const newWhen = new Date(input.new_scheduled_at);
  if (!Number.isFinite(newWhen.getTime()) || newWhen.getTime() < Date.now() - 60_000) {
    return {
      ok: false,
      reason: "past_visit",
      text: "Essa data nova não está válida. Me manda outra?",
    };
  }

  // Reusa a mesma validação do book_visit: dynamically import pra
  // evitar ciclo de módulos (book-visit também importa reschedule-ish).
  const { bookVisit } = await import("./book-visit");
  const validated = await bookVisit({
    lead_id: visit.lead_id,
    lead_phone: input.lead_phone,
    agent_id: visit.agent_id ?? "",
    scheduled_at: newWhen.toISOString(),
    empreendimento_id: visit.empreendimento_id,
    unidade_id: visit.unidade_id,
    created_by: input.actor ?? "bia",
    skip_whatsapp: true, // nós enviamos nossa própria msg abaixo
  });
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason === "slot_taken" ? "slot_taken" : "insert_failed",
      text:
        validated.reason === "slot_taken"
          ? "Esse novo horário já foi pego. Posso te oferecer alternativos?"
          : "Não consegui remarcar agora. Vou pedir pro corretor entrar em contato.",
    };
  }

  // O bookVisit criou uma NOVA row. Pra manter o histórico linear (um
  // reagendamento não gera 2 visits), cancelamos a antiga com
  // cancelled_reason "rescheduled_to:<new_id>".
  await updateVisitStatus(visit.id, "cancelled", {
    cancelled_reason: `rescheduled_to:${validated.visit_id ?? "unknown"}`,
    actor: input.actor ?? "bia",
  });

  // Mensagem unificada (cancela antiga + confirma nova).
  const text = formatRescheduleText(visit, newWhen);

  if (!input.skip_whatsapp) {
    try {
      await sendText({ to: input.lead_phone, text, delayMs: 800 });
    } catch (e) {
      console.error("[reschedule-visit] whatsapp:", e instanceof Error ? e.message : e);
      return {
        ok: true,
        reason: "whatsapp_failed",
        visit_id: validated.visit_id,
        text,
      };
    }

    // .ics atualizado (SEQUENCE=1, METHOD=REQUEST) pra o calendar do
    // lead substituir o evento antigo. Reusa o mesmo UID da visita
    // original — se não der pra resgatar (ex: criação pelo fluxo legado
    // sem UID estável), usa o id novo, o pior caso é duplicar evento.
    try {
      const ics = buildIcs({
        uid: `visit-${visit.id}@lumihaus`,
        startAt: newWhen.toISOString(),
        durationMin: 60,
        summary: "Visita Lumihaus (reagendada)",
        description: text,
        method: "REQUEST",
        sequence: 1,
      });
      await sendDocument({
        to: input.lead_phone,
        mediaBase64: icsToBase64(ics),
        fileName: "visita-reagendada.ics",
        mimetype: "text/calendar",
        caption: "Agenda atualizada — toca pra substituir o evento antigo.",
        delayMs: 1200,
      });
    } catch (e) {
      console.error(
        "[reschedule-visit] ics attachment failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return { ok: true, visit_id: validated.visit_id, text };
}

function formatRescheduleText(oldVisit: Visit, newWhen: Date): string {
  const oldStr = formatSlotPtBR({
    agent_id: "",
    start_at: oldVisit.scheduled_at,
    minute_of_day: 0,
    weekday: 0,
    local_date: "",
    timezone: "America/Sao_Paulo",
  });
  const newStr = formatSlotPtBR({
    agent_id: "",
    start_at: newWhen.toISOString(),
    minute_of_day: 0,
    weekday: 0,
    local_date: "",
    timezone: "America/Sao_Paulo",
  });
  return `Remarquei! Era ${oldStr} → agora ${newStr}. Te mando um lembrete 24h antes.`;
}

// ── cancel ───────────────────────────────────────────────────────────────

export type CancelVisitInput = {
  visit_id: string;
  lead_phone: string;
  reason?: string | null;
  actor?: string | null;
  skip_whatsapp?: boolean;
};

export type CancelVisitOutput = {
  ok: boolean;
  reason?: "visit_not_found" | "already_terminal" | "update_failed" | "whatsapp_failed";
  text: string;
};

export async function cancelVisit(input: CancelVisitInput): Promise<CancelVisitOutput> {
  const sb = supabaseAdmin();
  const { data: current } = await sb
    .from("visits")
    .select("*")
    .eq("id", input.visit_id)
    .maybeSingle();
  if (!current) {
    return {
      ok: false,
      reason: "visit_not_found",
      text: "Não achei essa visita. Pode me confirmar qual era a data?",
    };
  }
  const visit = current as Visit;
  if (["cancelled", "done", "no_show"].includes(visit.status)) {
    return {
      ok: false,
      reason: "already_terminal",
      text: `Essa visita já está ${visit.status}. Se quiser marcar uma nova, é só me avisar.`,
    };
  }

  const ok = await updateVisitStatus(input.visit_id, "cancelled", {
    cancelled_reason: input.reason ?? "lead_cancelled",
    actor: input.actor ?? "bia",
  });
  if (!ok) {
    return {
      ok: false,
      reason: "update_failed",
      text: "Não consegui cancelar agora. Vou pedir pro corretor resolver.",
    };
  }

  const text = `Cancelei a visita. Quando quiser remarcar, é só me avisar — tenho horários abertos na próxima semana.`;
  if (!input.skip_whatsapp) {
    try {
      await sendText({ to: input.lead_phone, text, delayMs: 800 });
    } catch (e) {
      console.error("[cancel-visit] whatsapp:", e instanceof Error ? e.message : e);
      return { ok: true, reason: "whatsapp_failed", text };
    }
  }
  return { ok: true, text };
}
