/**
 * Agent tools exportados. Por enquanto o answerNode NÃO faz tool-calling
 * explícito (modelo responde texto direto). Essas funções são chamáveis:
 *  - Do copilot no /handoff/[leadId] pra montar sugestões
 *  - De APIs server-side (ex: /api/leads/[id]/suggested-actions)
 *  - Futuramente do answerNode quando habilitarmos tool-use (TECH_DEBT#4-fase2)
 */

export {
  checkAvailability,
  type CheckAvailabilityInput,
  type CheckAvailabilityOutput,
} from "./check-availability";

export {
  scheduleVisit,
  type ScheduleVisitInput,
  type ScheduleVisitOutput,
} from "./schedule-visit";
