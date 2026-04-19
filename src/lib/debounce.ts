import type { Lead } from "@/lib/leads";

export type FlushHandler = (args: {
  lead: Lead;
  combinedText: string;
  sendTarget: string;
}) => Promise<void>;

type Pending = {
  buffer: string[];
  timer: NodeJS.Timeout;
  sendTarget: string;
  lead: Lead;
};

const pending = new Map<string, Pending>();
const DEBOUNCE_MS = Number(process.env.INBOUND_DEBOUNCE_MS ?? 4000);

/**
 * Bufferiza mensagens do mesmo lead numa janela de DEBOUNCE_MS.
 * Cada mensagem nova reseta o timer; quando o timer estoura, flush recebe o
 * texto concatenado (separado por \n) e a última sendTarget/lead vistas.
 *
 * Estado in-memory: funciona pq Railway roda single Node process.
 * Se migrar pra serverless multi-instância, trocar por Redis ou Postgres.
 */
export function scheduleInbound(args: {
  lead: Lead;
  text: string;
  sendTarget: string;
  flush: FlushHandler;
}) {
  const key = args.lead.id;
  const existing = pending.get(key);
  const buffer = existing ? [...existing.buffer, args.text] : [args.text];
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(async () => {
    pending.delete(key);
    const combinedText = buffer.join("\n");
    try {
      await args.flush({
        lead: args.lead,
        combinedText,
        sendTarget: args.sendTarget,
      });
    } catch (e) {
      console.error("[debounce] flush error", e);
    }
  }, DEBOUNCE_MS);

  pending.set(key, { buffer, timer, sendTarget: args.sendTarget, lead: args.lead });
}
