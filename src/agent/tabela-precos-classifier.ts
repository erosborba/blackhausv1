/**
 * Classifier puro do pre-tool-call de tabela de preços.
 *
 * Pure (I-4): sem DB, sem env, sem imports do projeto. Mantém o classifier
 * unit-testável com `node --test` (que não resolve aliases @/). O lado
 * side-effect (resolver empreendimento + chamar RPC) vive em
 * `tabela-precos-context.ts`.
 */

export type QueryIntent =
  | { kind: "unidade_por_numero"; numero: string }
  | {
      kind: "filtrar";
      tipologia: string | null;
      preco_min: number | null;
      preco_max: number | null;
      is_comercial: boolean | null;
    }
  | { kind: "listar_tipologias" }
  | { kind: "resumo" };

export function classifyQueryIntent(text: string): QueryIntent | null {
  const t = norm(text);

  // (1) Número de unidade: "1811", "unidade 301", "apto 1812", "L01".
  // Heurística: 3-4 dígitos isolados E formato plausível (101..3099, não
  // múltiplo de 100, não-ano), OU prefixado por unidade/apto/apt/ap/L.
  const numMatch = extractUnidadeNumero(text);
  if (numMatch) return { kind: "unidade_por_numero", numero: numMatch };

  // (2) Loja
  const isComercialHint = /\b(loja|lojas|comercial|sala comercial)\b/.test(t);

  // (3) Tipologia
  const tipologia = extractTipologia(t);

  // (4) Filtros de preço
  const preco = extractFaixaPreco(t);

  if (tipologia || preco.min != null || preco.max != null || isComercialHint) {
    return {
      kind: "filtrar",
      tipologia,
      preco_min: preco.min,
      preco_max: preco.max,
      is_comercial: isComercialHint ? true : null,
    };
  }

  // (5) Pergunta aberta
  if (
    /\b(tipologias?|o que tem|quais opcoes|quais as opcoes|que opcoes|qual opcao|opcoes disponiveis)\b/.test(t)
  ) {
    return { kind: "listar_tipologias" };
  }

  // (6) Resumo / entrega
  if (
    /\b(entrega|previsao de entrega|previsao|chaves|quando fica pronto|quando entrega|prazo da obra|resumo|visao geral|me conta sobre)\b/.test(
      t,
    )
  ) {
    return { kind: "resumo" };
  }

  return null;
}

export function extractUnidadeNumero(raw: string): string | null {
  const loja = raw.match(/\b[lL]\s*0?\d{1,3}\b/);
  if (loja) return loja[0].toUpperCase().replace(/\s+/, "");

  const prefixed = raw.match(/\b(?:unidade|apto|apt|ap)\.?\s*(\d{3,4})\b/i);
  if (prefixed) return prefixed[1];

  // Loose match: 3-4 dígitos isolados. Risco alto de roubar números que
  // são preços ("uma 350 mil"). Bloqueia se logo depois vier unidade
  // monetária (mil/milh/mi/k/reais) — claramente é valor, não unidade.
  const loose = raw.match(/\b(\d{3,4})(?!\d)\s*(mil|milh|milhao|milhoes|milhões|mi|k|reais|r\$)?\b/i);
  if (loose) {
    if (loose[2]) return null; // veio com unidade monetária — é preço.
    const n = Number(loose[1]);
    const isLikelyYear = n >= 1900 && n <= 2100;
    const isLikelyUnit =
      n >= 101 && n <= 3099 && n % 100 !== 0 && !isLikelyYear;
    if (isLikelyUnit) return loose[1];
  }
  return null;
}

export function extractTipologia(normText: string): string | null {
  // "estudio" = "estúdio" pós-norm (NFD remove acento). Aceita ambas grafias.
  if (/\b(studios?|estudios?|std)\b/.test(normText)) return "Studio";
  if (/\b1\s*q(uartos?)?\b|\b1qs?\b|\b1\s*dorm/.test(normText)) return "1Q";
  if (/\b2\s*q(uartos?)?\b|\b2qs?\b|\b2\s*dorm|dois quartos/.test(normText)) return "2Q";
  return null;
}

export function extractFaixaPreco(normText: string): { min: number | null; max: number | null } {
  // Hedges comuns entre "ate" e o número: "uns", "umas", "aprox(imadamente)",
  // "cerca de", "mais ou menos", "tipo". Sem isso, "até uns 400 mil" não casa.
  const HEDGE = "(?:uns?|umas?|aprox(?:imadamente)?|cerca de|mais ou menos|tipo)";
  const ate = normText.match(
    new RegExp(`\\bate\\s+(?:${HEDGE}\\s+)?(r?\\$?\\s*)?([\\d\\.,]+)\\s*(mil|milh|m)?\\b`),
  );
  const deAte = normText.match(
    /\bentre\s+([\d\.,]+)\s*(mil|milh|m)?\s*e\s+([\d\.,]+)\s*(mil|milh|m)?\b/,
  );
  const menor = normText.match(
    new RegExp(`\\b(?:menos|abaixo)\\s+de\\s+(?:${HEDGE}\\s+)?([\\d\\.,]+)\\s*(mil|milh|m)?\\b`),
  );

  let max: number | null = null;
  let min: number | null = null;
  if (deAte) {
    min = parseMoney(deAte[1], deAte[2]);
    max = parseMoney(deAte[3], deAte[4]);
  } else {
    if (ate) max = parseMoney(ate[2], ate[3]);
    if (menor) max = parseMoney(menor[1], menor[2]);
  }
  return { min, max };
}

export function parseMoney(raw: string, unit: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (unit && /mil/.test(unit)) return n * 1000;
  if (unit && /milh|^m$/.test(unit)) return n * 1_000_000;
  // Sem unidade: se for pequeno (tipo "400"), assume "mil". 400 = R$ 400k.
  if (n < 10000) return n * 1000;
  return n;
}

export function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
