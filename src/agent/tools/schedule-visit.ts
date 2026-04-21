import { createVisit, type Visit } from "@/lib/visits";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Agent tool: schedule_visit.
 *
 * Bia propõe um horário → chamada dessa função cria a visita e responde
 * com texto de confirmação. Quem realmente agenda é sempre um humano (o
 * lead confirma via WhatsApp); essa função só registra o estado.
 *
 * Se a data estiver ambígua (string natural tipo "amanhã 14h"), caller é
 * responsável por resolver pra ISO antes de chamar — mantemos o agent
 * tool puro.
 */

export type ScheduleVisitInput = {
  lead_id: string;
  empreendimento_id?: string | null;
  unidade_id?: string | null;
  scheduled_at: string; // ISO timestamp
  /** Notas livres — motivo, tipologia de interesse, quem vai junto. */
  notes?: string | null;
  /** Quem está pedindo? 'bia' | 'corretor:<id>' | 'lead'. */
  created_by?: string | null;
  agent_id?: string | null;
};

export type ScheduleVisitOutput = {
  ok: boolean;
  reason?: "invalid_date" | "past_date" | "insert_failed";
  visit_id?: string;
  text: string;
};

export async function scheduleVisit(input: ScheduleVisitInput): Promise<ScheduleVisitOutput> {
  const when = new Date(input.scheduled_at);
  if (Number.isNaN(when.getTime())) {
    return {
      ok: false,
      reason: "invalid_date",
      text: "Não consegui entender a data. Pode me dizer de novo no formato 'dia/mês hora'?",
    };
  }
  if (when.getTime() < Date.now() - 60_000) {
    return {
      ok: false,
      reason: "past_date",
      text: "Essa data já passou. Me manda uma data futura?",
    };
  }

  const visit = await createVisit({
    lead_id: input.lead_id,
    empreendimento_id: input.empreendimento_id ?? null,
    unidade_id: input.unidade_id ?? null,
    agent_id: input.agent_id ?? null,
    scheduled_at: when.toISOString(),
    notes: input.notes ?? null,
    created_by: input.created_by ?? "bia",
  });
  if (!visit) {
    return {
      ok: false,
      reason: "insert_failed",
      text: "Deu um ruído aqui do meu lado. Vou pedir pro corretor entrar em contato pra confirmar a visita.",
    };
  }

  const empNome = await maybeGetEmpreendimentoNome(visit);
  return {
    ok: true,
    visit_id: visit.id,
    text: formatConfirmation(visit, empNome),
  };
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
  const when = new Date(visit.scheduled_at).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const loc = empNome ? ` em ${empNome}` : "";
  return `Anotado! Visita agendada pra ${when}${loc}. Se precisar remarcar, é só me avisar.`;
}
