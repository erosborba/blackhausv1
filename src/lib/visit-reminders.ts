/**
 * Lembretes e follow-ups de visitas — Track 2 · Slices 2.6 + 2.7.
 *
 * Scan periódico (cron a cada 5min) que:
 *   - 24h antes da visita: envia lembrete
 *   - 2h antes: envia nudge final
 *   - Dia seguinte 9h (no timezone BR): pergunta "como foi?"
 *
 * Idempotência: tabela `visit_reminders_sent` (visit_id, kind) unique.
 * Se a row existe, não re-envia.
 *
 * Invariants: I-2 (nunca envia pra phone 5555*), I-3 (custo
 * observável — cada envio passa por sendText), G-3 (rate de sucesso
 * entra no dashboard /gestor/health futuro).
 */
import { supabaseAdmin } from "./supabase";
import { sendText } from "./evolution";

export type ReminderKind = "24h" | "2h" | "post_visit";

export type ReminderScanResult = {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  byKind: Record<ReminderKind, number>;
};

// Janelas de busca de cada kind. Usamos faixas relativas ao `now` pra
// tolerar latência de cron (ex: se cron rodar a cada 5min, a janela
// precisa ser >= 5min pra não perder lembrete).
const WINDOW_24H_MIN = 24 * 60 - 10; // 23h50 antes
const WINDOW_24H_MAX = 24 * 60 + 10; // 24h10 antes
const WINDOW_2H_MIN = 2 * 60 - 10;
const WINDOW_2H_MAX = 2 * 60 + 10;
const POST_VISIT_HOURS = 17; // horas DEPOIS da visita (dia seguinte 9h BR ≈ 16-18h após visita típica das 14h)
const POST_VISIT_WINDOW_MIN = 60; // tolerância ampla

export async function scanVisitReminders(): Promise<ReminderScanResult> {
  const result: ReminderScanResult = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    byKind: { "24h": 0, "2h": 0, post_visit: 0 },
  };
  const sb = supabaseAdmin();
  const now = Date.now();

  // 1. Busca visitas candidatas (status scheduled/confirmed, janela de -25h a +25h).
  const horizonFrom = new Date(now - 26 * 3600_000).toISOString();
  const horizonTo = new Date(now + 26 * 3600_000).toISOString();
  const { data: visits, error } = await sb
    .from("visits")
    .select("id, lead_id, scheduled_at, status, empreendimento_id")
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", horizonFrom)
    .lt("scheduled_at", horizonTo)
    .limit(200);
  if (error) {
    console.error("[visit-reminders] query:", error.message);
    return result;
  }
  result.scanned = (visits ?? []).length;
  if (result.scanned === 0) return result;

  // 2. Pra cada visit, resolve (kind esperado agora) e processa se aplicável.
  for (const v of visits ?? []) {
    const row = v as {
      id: string;
      lead_id: string;
      scheduled_at: string;
      empreendimento_id: string | null;
    };
    const kind = resolveReminderKind(row.scheduled_at, now);
    if (!kind) {
      result.skipped++;
      continue;
    }

    // Idempotência: já mandamos este kind?
    const { data: already } = await sb
      .from("visit_reminders_sent")
      .select("id")
      .eq("visit_id", row.id)
      .eq("kind", kind)
      .maybeSingle();
    if (already) {
      result.skipped++;
      continue;
    }

    // Busca dados do lead + empreendimento pra formatar
    const ctx = await loadReminderContext(row.lead_id, row.empreendimento_id);
    if (!ctx) {
      result.skipped++;
      continue;
    }

    // I-2: phone 5555* não recebe nada
    if (ctx.phone.startsWith("5555") || ctx.phone.startsWith("eval_")) {
      result.skipped++;
      continue;
    }

    const text = formatReminder(kind, ctx, row.scheduled_at);

    // Envia + grava idempotência numa transação otimista. Se sendText
    // lançar, gravamos com ok=false pra não re-tentar (timeouts de
    // WhatsApp tendem a repetir o envio).
    let ok = true;
    let errMsg: string | null = null;
    try {
      await sendText({ to: ctx.phone, text, delayMs: 1200 });
    } catch (e) {
      ok = false;
      errMsg = e instanceof Error ? e.message : String(e);
    }

    const { error: insertErr } = await sb
      .from("visit_reminders_sent")
      .insert({
        visit_id: row.id,
        kind,
        ok,
        error: errMsg,
      });
    if (insertErr) {
      // Race com outro runner do cron — já foi mandado, contabiliza skip.
      if (insertErr.code === "23505") {
        result.skipped++;
        continue;
      }
      console.error("[visit-reminders] insert_sent:", insertErr.message);
    }

    if (ok) {
      result.sent++;
      result.byKind[kind]++;
    } else {
      result.failed++;
    }
  }

  return result;
}

function resolveReminderKind(scheduledAtIso: string, nowMs: number): ReminderKind | null {
  const scheduled = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(scheduled)) return null;
  const minutesUntil = (scheduled - nowMs) / 60_000;

  // Pré-visita: 24h e 2h antes
  if (minutesUntil >= WINDOW_24H_MIN && minutesUntil <= WINDOW_24H_MAX) return "24h";
  if (minutesUntil >= WINDOW_2H_MIN && minutesUntil <= WINDOW_2H_MAX) return "2h";

  // Pós-visita: ~17h depois
  const minutesAfter = -minutesUntil;
  if (minutesAfter >= POST_VISIT_HOURS * 60 - POST_VISIT_WINDOW_MIN &&
      minutesAfter <= POST_VISIT_HOURS * 60 + POST_VISIT_WINDOW_MIN) {
    return "post_visit";
  }

  return null;
}

type ReminderContext = {
  phone: string;
  lead_name: string;
  empreendimento_nome: string | null;
};

async function loadReminderContext(
  leadId: string,
  empId: string | null,
): Promise<ReminderContext | null> {
  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("phone, push_name, full_name")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return null;
  const l = lead as { phone: string; push_name: string | null; full_name: string | null };
  let empNome: string | null = null;
  if (empId) {
    const { data: emp } = await sb
      .from("empreendimentos")
      .select("nome")
      .eq("id", empId)
      .maybeSingle();
    empNome = (emp as { nome: string } | null)?.nome ?? null;
  }
  const name = firstName(l.full_name ?? l.push_name ?? null);
  return {
    phone: l.phone,
    lead_name: name,
    empreendimento_nome: empNome,
  };
}

function firstName(full: string | null): string {
  if (!full) return "";
  return full.split(/\s+/)[0]?.trim() ?? "";
}

function formatReminder(
  kind: ReminderKind,
  ctx: ReminderContext,
  scheduledAtIso: string,
): string {
  const when = new Date(scheduledAtIso).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const nome = ctx.lead_name ? `${ctx.lead_name}, ` : "";
  const loc = ctx.empreendimento_nome ? ` em ${ctx.empreendimento_nome}` : "";

  if (kind === "24h") {
    return (
      `${nome}passando pra lembrar da visita amanhã, ${when}${loc}. ` +
      `Tá tudo certo pra você? Se precisar remarcar, é só me avisar.`
    );
  }
  if (kind === "2h") {
    return (
      `${nome}sua visita é daqui a pouco, às ${new Date(scheduledAtIso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}${loc}. ` +
      `Te vejo lá!`
    );
  }
  // post_visit
  return (
    `${nome}e aí, como foi a visita${loc}? ` +
    `Me conta o que achou — posso te ajudar com próximos passos (outros empreendimentos similares, simulação, ou dúvidas).`
  );
}
