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

export {
  proposeVisitSlots,
  type ProposeVisitSlotsInput,
  type ProposeVisitSlotsOutput,
} from "./propose-visit-slots";

export {
  bookVisit,
  type BookVisitInput,
  type BookVisitOutput,
} from "./book-visit";

export {
  rescheduleVisit,
  cancelVisit,
  type RescheduleVisitInput,
  type RescheduleVisitOutput,
  type CancelVisitInput,
  type CancelVisitOutput,
} from "./reschedule-visit";

export {
  checkMcmv,
  type CheckMcmvInput,
  type CheckMcmvOutput,
} from "./check-mcmv";

export {
  simulateFinancing,
  type SimulateFinancingInput,
  type SimulateFinancingOutput,
} from "./simulate-financing";

export {
  sendEmpreendimentoFotos,
  type SendEmpreendimentoFotosInput,
  type SendEmpreendimentoFotosOutput,
} from "./send-empreendimento-fotos";

export {
  sendEmpreendimentoBooking,
  type SendEmpreendimentoBookingInput,
  type SendEmpreendimentoBookingOutput,
} from "./send-empreendimento-booking";

export {
  consultarUnidade,
  type ConsultarUnidadeInput,
  type ConsultarUnidadeOutput,
} from "./consultar-unidade";

export {
  filtrarUnidades,
  type FiltrarUnidadesInput,
  type FiltrarUnidadesOutput,
} from "./filtrar-unidades";

export {
  listarTipologias,
  type ListarTipologiasInput,
  type ListarTipologiasOutput,
} from "./listar-tipologias";

export {
  resumoTabelaPrecos,
  type ResumoTabelaPrecosInput,
  type ResumoTabelaPrecosOutput,
} from "./resumo-tabela-precos";
