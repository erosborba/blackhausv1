/**
 * Vanguard · Track 3 · Slice 3.6a — predicado puro pra ponte
 * copilot_suggestions → handoff.
 *
 * Quando a Bia gera uma sugestão copilot (simulation/MCMV), a gente precisa
 * garantir que um humano vai OLHAR pra ela. Sem UI do card ainda (3.6b),
 * a defesa é criar um handoff motivado `ia_incerta` — o corretor recebe a
 * notificação no WhatsApp pelo pipeline normal e aparece na lista de
 * handoffs pendentes. Quando a UI do card aterrissar em 3.6b, o fluxo
 * continuará (handoff + card) pra corretor ter as duas superfícies.
 *
 * Por que `ia_incerta` + urgência `baixa` (usados pelo wrapper em
 * `copilot-suggestions.ts`):
 *   - `ia_incerta` é o motivo canônico pra "Bia não quer assumir sozinha"
 *     (já usado pelo factcheck quando claim numérica não bate).
 *   - Baixa urgência: sugestão copilot não é lead pedindo humano; é só
 *     revisão de cálculo. Não queremos furar o 🔴 alta dos leads realmente
 *     quentes. A revisão entra na fila normal do corretor.
 *
 * Este arquivo é PURO (I-4): sem DB, sem env. Isso mantém o predicado
 * unit-testável sem precisar de Supabase mockado. O lado side-effect
 * (ler lead + chamar initiateHandoff) vive em `copilot-suggestions.ts`
 * porque é o único call-site e evita import circular.
 */

export type LeadHandoffState = {
  bridge_active: boolean | null;
  human_takeover: boolean | null;
  handoff_notified_at: string | null;
  handoff_resolved_at: string | null;
};

/**
 * Decide se uma sugestão nova deve disparar criação de handoff. True
 * quando o lead ainda NÃO tem atenção humana ativa:
 *
 *   - `bridge_active` = corretor já tá em ponte com o lead — redundante.
 *   - `human_takeover` = corretor pausou a Bia manualmente — já assumiu.
 *   - `handoff_notified_at` sem `handoff_resolved_at` = handoff pendente.
 *     Criar outro duplicaria a notificação.
 *   - `handoff_notified_at` COM `handoff_resolved_at` = ciclo anterior
 *     fechado (corretor deu feedback). Novo fire é legítimo — o lead
 *     mandou mensagem nova, Bia gerou sugestão nova.
 */
export function shouldCreateHandoffForSuggestion(lead: LeadHandoffState): boolean {
  if (lead.bridge_active) return false;
  if (lead.human_takeover) return false;
  if (lead.handoff_notified_at && !lead.handoff_resolved_at) return false;
  return true;
}
