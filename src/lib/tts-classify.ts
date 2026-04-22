/**
 * Vanguard · Track 4 · Slice 4.3 — classifier de modalidade (áudio × texto).
 *
 * Regra é simples e dura: áudio só serve pra fala natural. Qualquer
 * indício de dado estruturado (valor, data, bullet, endereço, lista)
 * derruba a decisão pra texto, mesmo que o lead prefira áudio. A Bia
 * ao ler "R$ 532.935" em voz fica robótica; "Alameda Carlos de
 * Carvalho, 256" vira soletração. Isso é calibração de produto, não
 * de modelo — nenhuma voz resolveria bem.
 *
 * Decisão final (`shouldUseAudio`):
 *   audio = leadPrefersAudio  &&  source === "llm"  &&  contentIsAudible(text)
 *
 * - leadPrefersAudio: ≥1 das últimas 3 msgs do lead foi áudio. Computado
 *   no webhook via query (ver `leadPrefersAudio` em src/lib/copilot-audio.ts
 *   ou similar). Flag é consumida aqui, não calculada.
 *
 * - source: "tool" quando a resposta vem de ToolMessage (finance,
 *   mcmv, fotos, booking). Tool output é estrutura por design → sempre
 *   texto. "llm" quando veio do `answerNode` como fala livre.
 *
 * - contentIsAudible: filtro determinístico baseado em sinais de
 *   conteúdo (tabela abaixo).
 *
 * Invariantes:
 *   - Módulo puro. Sem supabase, sem env, sem fetch. Testável em node:test
 *     sem mock. Mirror de `tts-pure.ts` e `copilot-handoff.ts`.
 *   - Determinístico. Mesmo input → mesmo `{audio, reason}`. Reason é
 *     slug estável pra logar em ai_usage_log/debug sem coupling a copy.
 *
 * Sinais que derrubam áudio (`reason` quando aplicável):
 *   currency_symbol  — R$, US$, €
 *   measurement_unit — m², km, m2, km²
 *   percent          — %
 *   long_number      — ≥ 4 dígitos consecutivos, ou número com separador de milhar
 *   date             — dd/mm, dd/mm/yy, mês/ano abreviado (nov/29), mês por extenso
 *   multiline        — ≥ 2 quebras de linha (3+ linhas) = lista
 *   bullet           — início de linha com *, •, -, emoji+espaço
 *   address          — "Palavra Capitalizada, 123" ou Rua/Avenida/Alameda
 *   too_long         — length > 300 chars
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ModalitySource = "llm" | "tool";

export type ModalityDecision = {
  audio: boolean;
  /**
   * Slug identificando por que rejeitou (ou "ok" se aceitou). Usado
   * pra rastrear no log — se "too_long" dominar, a gente sabe que
   * a Bia tá gerando respostas muito longas e encurta o prompt.
   */
  reason: string;
};

export type ShouldUseAudioInput = {
  text: string;
  leadPrefersAudio: boolean;
  source: ModalitySource;
};

// ---------------------------------------------------------------------------
// Classifier público
// ---------------------------------------------------------------------------

/**
 * Decisão final. Triagem em cascata: primeiro os overrides baratos
 * (preferência, source), depois o classifier de conteúdo.
 */
export function shouldUseAudio(input: ShouldUseAudioInput): ModalityDecision {
  if (!input.leadPrefersAudio) {
    return { audio: false, reason: "lead_prefers_text" };
  }
  if (input.source === "tool") {
    return { audio: false, reason: "tool_output" };
  }
  return classifyContent(input.text);
}

// ---------------------------------------------------------------------------
// classifyContent — testa o texto isolado, assumindo que A && !B passaram
// ---------------------------------------------------------------------------

/**
 * Verifica se o texto é sonorizável. Roda os sinais em ordem de
 * custo ascendente (length → substring → regex complexa) pra sair
 * cedo quando possível.
 *
 * Exposto pra testes unitários só do filtro de conteúdo.
 */
export function classifyContent(rawText: string): ModalityDecision {
  const text = rawText.trim();

  // Vazio não vai por áudio de jeito nenhum (não deveria chegar aqui,
  // mas belt-and-suspenders).
  if (text.length === 0) {
    return { audio: false, reason: "empty" };
  }

  // Length — corte duro. Fala de 300+ chars passa dos 25s facilmente,
  // cansa lead e quase sempre tem estrutura junto. Se quisermos áudio
  // em monólogo longo, aumentar aqui é consciente.
  if (text.length > 300) {
    return { audio: false, reason: "too_long" };
  }

  // Multiline — lista, não fala. Conta quebras de linha: 2+ \n = 3+ linhas.
  const newlineCount = (text.match(/\n/g) ?? []).length;
  if (newlineCount >= 2) {
    return { audio: false, reason: "multiline" };
  }

  // Bullets no início de linha (com `m` flag). Aceita *, •, -, ou emoji
  // seguido de espaço/colon. Padrão típico de resposta estruturada.
  if (/^[\*•\-]\s/m.test(text)) {
    return { audio: false, reason: "bullet" };
  }
  if (/^\p{Extended_Pictographic}\s+\S/mu.test(text)) {
    return { audio: false, reason: "bullet" };
  }

  // Moeda / unidades.
  if (/R\$|US\$|€/.test(text)) {
    return { audio: false, reason: "currency_symbol" };
  }
  if (/\bm²|\bm2\b|\bkm²?\b/i.test(text)) {
    return { audio: false, reason: "measurement_unit" };
  }
  if (/%/.test(text)) {
    return { audio: false, reason: "percent" };
  }

  // Números longos / financeiros:
  //   - 4+ dígitos consecutivos (532935)
  //   - número com separador de milhar (1.404, 532.935, 2,500)
  if (/\d{4,}/.test(text)) {
    return { audio: false, reason: "long_number" };
  }
  if (/\d+[.,]\d{3}(?!\d)/.test(text)) {
    return { audio: false, reason: "long_number" };
  }

  // Datas:
  //   - dd/mm, dd/mm/yy, dd/mm/yyyy
  //   - mês abreviado + ano (nov/29, jan/2030)
  //   - mês por extenso (janeiro, fevereiro, ...)
  if (/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(text)) {
    return { audio: false, reason: "date" };
  }
  if (/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2,4}\b/i.test(text)) {
    return { audio: false, reason: "date" };
  }
  if (
    /\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i.test(
      text,
    )
  ) {
    return { audio: false, reason: "date" };
  }

  // Endereços:
  //   - "Alameda X, 256" / "Rua Y, 1234"
  //   - Também pega "Palavra Capitalizada, <dígitos>"
  if (
    /\b(rua|avenida|alameda|travessa|estrada|rodovia|praça|praca|largo|beco)\b\s+\S/i.test(text) &&
    /,\s*\d+/.test(text)
  ) {
    return { audio: false, reason: "address" };
  }
  // Fallback mais frouxo: palavra capitalizada multi-word seguida de vírgula+número
  // (ex.: "Centro, 256"). Evita falso-positivo em "Oi, tenho 25".
  if (/[A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]{3,}(\s+[A-Za-záéíóúâêôãõç]+){0,4}\s*,\s*\d+/.test(text)) {
    return { audio: false, reason: "address" };
  }

  return { audio: true, reason: "ok" };
}
