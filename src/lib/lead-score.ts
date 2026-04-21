import type { Qualification } from "./leads";
import type { Intent, Stage } from "@/agent/state";

/**
 * Lead scoring (0–100).
 *
 * Rodado no router node a cada turno (custo: ~0ms, puro CPU). O número sobe
 * conforme o lead:
 *   - Preenche qualificação (fit)
 *   - Avança nos estágios (progressão)
 *   - Engaja com turnos frequentes (interesse)
 *   - Expressa urgência (reason/urgency do handoff)
 *
 * Componentes (somam e capam em 100):
 *
 *   Fit (0–50): 10 pts por campo crítico preenchido em qualification.
 *     Campos considerados: tipo, quartos, cidade, faixa_preco_max, prazo.
 *
 *   Stage (0–25):
 *     greet=0, discover=5, qualify=10, recommend=15, schedule=25, handoff=20.
 *
 *   Engagement (0–15):
 *     min(msgCount, 15). Lead que trocou 15+ mensagens tá engajado.
 *
 *   Urgency (0–10):
 *     handoff_urgency alta=10, media=5, baixa=2. Sem handoff: 0.
 *     Exceção: intent=agendar soma +5 mesmo sem handoff (interesse declarado).
 *
 * Decisão: números inteiros, transparentes, explicáveis. Futura evolução
 * pode pesar por channel, recência, histórico — mas começa simples pra não
 * criar black-box no funil.
 */

const FIT_FIELDS: (keyof Qualification)[] = [
  "tipo",
  "quartos",
  "cidade",
  "faixa_preco_max",
  "prazo",
];

const STAGE_POINTS: Record<Stage, number> = {
  greet: 0,
  discover: 5,
  qualify: 10,
  recommend: 15,
  schedule: 25,
  handoff: 20,
};

export type ScoreBreakdown = {
  fit: number;
  stage: number;
  engagement: number;
  urgency: number;
  total: number;
};

export type ScoreInput = {
  qualification: Qualification;
  stage: Stage | null | undefined;
  intent: Intent | null | undefined;
  messageCount: number;
  handoffUrgency: "alta" | "media" | "baixa" | null;
};

export function computeLeadScore(input: ScoreInput): ScoreBreakdown {
  // Fit: cada campo crítico vale 10 pts
  let fit = 0;
  for (const k of FIT_FIELDS) {
    const v = input.qualification[k];
    const filled = v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
    if (filled) fit += 10;
  }

  // Stage
  const stage = input.stage ? (STAGE_POINTS[input.stage] ?? 0) : 0;

  // Engagement: cap em 15
  const engagement = Math.max(0, Math.min(15, input.messageCount));

  // Urgency
  let urgency = 0;
  if (input.handoffUrgency === "alta") urgency = 10;
  else if (input.handoffUrgency === "media") urgency = 5;
  else if (input.handoffUrgency === "baixa") urgency = 2;
  if (input.intent === "agendar") urgency = Math.min(10, urgency + 5);

  const total = Math.max(0, Math.min(100, fit + stage + engagement + urgency));

  return { fit, stage, engagement, urgency, total };
}
