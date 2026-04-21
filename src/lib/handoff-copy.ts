/**
 * Copy canônica de handoff — centralizada pra usar em server + client.
 *
 * Antes estava duplicada em `state.ts` (server), `inbox-client.tsx`,
 * `thread-client.tsx` e `funnel/page.tsx`. Fechou TECH_DEBT 🟢 item 1.
 *
 * Este módulo é **puro**: zero imports de DB/LLM/SDK. Pode ser importado
 * de qualquer componente client sem arrastar server-only deps.
 *
 * A fonte da verdade dos TIPOS (`HandoffReason`, `HandoffUrgency`)
 * continua em `src/agent/state.ts` pra não circular; re-exportamos aqui
 * só o que o UI consome.
 */

export type HandoffReason =
  | "lead_pediu_humano"
  | "fora_de_escopo"
  | "objecao_complexa"
  | "ia_incerta"
  | "urgencia_alta"
  | "escalacao"
  | "outro";

export type HandoffUrgency = "baixa" | "media" | "alta";

export const HANDOFF_REASON_LABEL: Record<HandoffReason, string> = {
  lead_pediu_humano: "Lead pediu humano",
  fora_de_escopo: "Fora de escopo",
  objecao_complexa: "Objeção complexa (preço/prazo)",
  ia_incerta: "IA incerta — precisa confirmar",
  urgencia_alta: "Urgência alta",
  escalacao: "Escalação (corretor não respondeu)",
  outro: "Outro",
};

export const HANDOFF_URGENCY_EMOJI: Record<HandoffUrgency, string> = {
  baixa: "🟢",
  media: "🟡",
  alta: "🔴",
};

/** Ordem canônica pra renderizar listas/tabelas. */
export const HANDOFF_REASON_ORDER: HandoffReason[] = [
  "lead_pediu_humano",
  "urgencia_alta",
  "objecao_complexa",
  "ia_incerta",
  "fora_de_escopo",
  "escalacao",
  "outro",
];

export const HANDOFF_URGENCY_ORDER: HandoffUrgency[] = ["alta", "media", "baixa"];

/** Cor semântica (tokens) por urgência — usada em badges/chips. */
export const HANDOFF_URGENCY_TONE: Record<HandoffUrgency, "hot" | "warm" | "cool"> = {
  alta: "hot",
  media: "warm",
  baixa: "cool",
};

/** Helper pra badge compacto: emoji + label curto. */
export function handoffBadge(
  reason: HandoffReason | null | undefined,
  urgency: HandoffUrgency | null | undefined,
): { emoji: string; label: string } | null {
  if (!reason) return null;
  const emoji = urgency ? HANDOFF_URGENCY_EMOJI[urgency] : "⚠️";
  const label = HANDOFF_REASON_LABEL[reason] ?? reason;
  return { emoji, label };
}
