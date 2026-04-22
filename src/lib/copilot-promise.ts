/**
 * Vanguard · Track 3 · Slice 3.5a — texto-promessa do modo copilot.
 *
 * Quando uma tool financeira roda em `mode='copilot'`, a Bia não envia
 * os números — devolve uma promessa curta de que o consultor vai
 * responder. Esta função decide a linguagem baseada na hora do dia
 * pra não mentir: "em instantes" só em horário comercial, "ainda hoje"
 * no fim da tarde, "amanhã cedo" à noite/madrugada/fim de semana.
 *
 * Regras:
 *   - Seg-Sex 09:00–17:59 (inclusive) → "em instantes"
 *   - Seg-Sex 18:00–21:59             → "ainda hoje"
 *   - Demais (noite, madrugada, fins de semana) → "amanhã cedo"
 *
 * Função pura: recebe `now` como parâmetro pra ser determinística e
 * testável. Timezone fixo em America/Sao_Paulo (operação da Lumihaus).
 *
 * Invariants:
 *   - I-6: mesmo `now` + mesmo `kind` = mesmo texto
 *   - Promessa nunca é "agora" ou "em segundos" — sempre deixa margem
 *     pro corretor abrir o inbox
 */

export type CopilotPromiseKind = "simulation" | "mcmv";
export type CopilotPromiseWindow = "business_hours" | "evening" | "off_hours";

export type CopilotPromiseInput = {
  now: Date;
  kind: CopilotPromiseKind;
  /** Nome do lead pra personalizar. Opcional. */
  nome?: string | null;
};

/**
 * Converte `now` pra horário em SP (GMT-03:00). Nota: o Brasil não
 * usa DST desde 2019, então offset fixo de -3h dá o resultado certo
 * o ano inteiro. Se voltar o horário de verão, trocar por Intl.DateTimeFormat.
 */
function saoPauloParts(d: Date): { weekday: number; hour: number } {
  // Offset fixo -3h (sem DST no BR pós-2019).
  const spMs = d.getTime() - 3 * 60 * 60 * 1000;
  const sp = new Date(spMs);
  // getUTC* depois do shift dá hora/dia de São Paulo.
  return { weekday: sp.getUTCDay(), hour: sp.getUTCHours() };
}

/**
 * Bucket de horário pro texto. Exportado pra testes e pra callers que
 * queiram montar telemetria (ex.: "quantas promessas foram feitas em
 * off_hours na semana?").
 */
export function promiseWindow(now: Date): CopilotPromiseWindow {
  const { weekday, hour } = saoPauloParts(now);
  const isWeekend = weekday === 0 || weekday === 6;
  if (isWeekend) return "off_hours";
  if (hour >= 9 && hour < 18) return "business_hours";
  if (hour >= 18 && hour < 22) return "evening";
  return "off_hours";
}

/**
 * Gera o texto-promessa da Bia. Não inclui os números da simulação —
 * esses vão pro `copilot_suggestions` pro corretor revisar.
 */
export function buildCopilotPromise(input: CopilotPromiseInput): string {
  const greet = input.nome ? `${input.nome}, ` : "";
  const assunto =
    input.kind === "simulation"
      ? "os números da simulação"
      : "a confirmação da faixa do MCMV";

  const window = promiseWindow(input.now);
  switch (window) {
    case "business_hours":
      return `${greet}vou puxar ${assunto} com o consultor aqui do time pra te passar certinho. Te chamo de volta em instantes.`;
    case "evening":
      return `${greet}vou alinhar ${assunto} com o consultor e te respondo ainda hoje.`;
    case "off_hours":
    default:
      return `${greet}vou preparar ${assunto} com o consultor e te respondo amanhã cedo, no horário comercial.`;
  }
}
