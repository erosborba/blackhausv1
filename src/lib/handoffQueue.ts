// Timer em memória pra escalação de handoff.
//
// Quando um corretor é notificado, marcamos um setTimeout de 5min. Se o
// corretor abrir a ponte antes (bridge_active=true via webhook), cancelamos.
// Se o timer disparar, chamamos `escalateToNext` que busca o próximo corretor.
//
// Limitações: timer é in-memory. Em deploy single-instance (Railway atual) OK.
// Em multi-instance precisaríamos de fila persistente (Redis/QStash). Se o
// processo cair entre notificação e timeout, o lead fica órfão até alguém
// abrir o admin — aceito pro MVP.

type EscalationHandler = (leadId: string) => Promise<void>;

const timers = new Map<string, NodeJS.Timeout>();

const ESCALATION_MS = Number(process.env.HANDOFF_ESCALATION_MS ?? 5 * 60 * 1000);

export function scheduleEscalation(args: {
  leadId: string;
  onEscalate: EscalationHandler;
  delayMs?: number;
}) {
  cancelEscalation(args.leadId);
  const timer = setTimeout(async () => {
    timers.delete(args.leadId);
    try {
      await args.onEscalate(args.leadId);
    } catch (e) {
      console.error("[handoffQueue] escalation error for", args.leadId, e);
    }
  }, args.delayMs ?? ESCALATION_MS);
  timers.set(args.leadId, timer);
}

export function cancelEscalation(leadId: string) {
  const t = timers.get(leadId);
  if (t) {
    clearTimeout(t);
    timers.delete(leadId);
  }
}

export function hasPendingEscalation(leadId: string): boolean {
  return timers.has(leadId);
}
