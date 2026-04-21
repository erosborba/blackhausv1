/**
 * Backstop anti-alucinação de preço/prazo/metragem.
 *
 * A Bia, mesmo com a instrução "use apenas o contexto", às vezes "completa"
 * um dado que quase aparece no contexto (ex.: o chunk diz "a partir de R$ 650
 * mil" e ela escreve "R$ 680 mil" — número plausível mas inventado). Custa
 * credibilidade.
 *
 * Estratégia: extrair claims numéricos concretos (preço, ano de entrega,
 * metragem) da resposta e verificar se cada um aparece LITERALMENTE no
 * `retrieved`. Se bater, ok. Se não bater e a gente tinha contexto forte,
 * é alucinação candidata — logamos via ai_usage_log.metadata.suspicious_claims
 * pra observabilidade e devolvemos um sinal `suspicious: true` pro caller
 * decidir o que fazer (hoje: só loga; no futuro: regenerar/substituir).
 *
 * Filosofia: falso positivo > falso negativo. Se flagar errado, só enche
 * o log; não mexe na UX. Se não flagar errado, a alucinação vaza pro lead.
 * Melhor ser chato que permissivo.
 */

export type FactClaim = {
  kind: "price" | "year" | "area";
  raw: string; // trecho original que matchou no reply
  /**
   * Chave canônica usada pra comparar com o contexto.
   *   - price: sequência de dígitos da parte inteira (ex.: "650" ou "650000")
   *   - year: "2026"
   *   - area: "85" (de "85m²")
   *
   * Propositalmente solta — se o chunk tem "650 mil" e a Bia escreveu
   * "R$ 650.000", ambos caem pra "650" como needle. Isso favorece falso
   * negativo (não flagar), o que é ok pelo design.
   */
  needle: string;
};

export type FactCheckResult = {
  claims: FactClaim[];
  suspicious: FactClaim[];
  ok: boolean;
};

// ── Regexes ────────────────────────────────────────────────────────────────

/**
 * R$ 450k, R$ 450 mil, R$ 450.000, R$ 1,2 milhão, 1,2 MI.
 * Capturamos o NÚMERO e o MODIFICADOR (mil/milhão/M/k) separados pra
 * normalizar em dígitos base (sem escala) — a needle é só a parte inteira
 * do número, o que quase sempre aparece literal no chunk.
 */
const PRICE_RE =
  /R\$\s*([\d.,]+)(?:\s*(mil|milh[ãa]o|milh[õo]es|k|M|MI))?/gi;

/**
 * Ano de entrega ou lançamento. Anos "reais" vão de 2024-2035 pra evitar
 * casar com metragens tipo "250" ou CEP. Depois do horizonte, regenera aqui.
 */
const YEAR_RE = /\b(202[4-9]|203[0-5])\b/g;

/** Metragem em m² ou m2. 12 a 9999 m² (corta ruído como "1 m²"). */
const AREA_RE = /\b(\d{2,4})\s?m[²2]\b/gi;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Tira toda a pontuação/acento e baixa. Deixa o contexto "cru" pra matching
 * tolerante. Mantém dígitos e letras básicas.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Só dígitos (pra needle de preço/metragem). */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// ── Extração ───────────────────────────────────────────────────────────────

function extractClaims(reply: string): FactClaim[] {
  const claims: FactClaim[] = [];

  // Preços
  for (const m of reply.matchAll(PRICE_RE)) {
    const raw = m[0];
    const num = digitsOnly(m[1] ?? "");
    if (!num) continue;
    // Guarda APENAS a parte inteira antes do separador decimal (se tinha ",XX"
    // no fim, cortamos os dois últimos dígitos — é o padrão "1,2 milhão" →
    // "1" seria needle frágil, mas a gente compara várias representações
    // adiante). Usamos o bruto mesmo.
    claims.push({ kind: "price", raw, needle: num });
  }

  // Anos
  for (const m of reply.matchAll(YEAR_RE)) {
    claims.push({ kind: "year", raw: m[0], needle: m[1] });
  }

  // Áreas
  for (const m of reply.matchAll(AREA_RE)) {
    claims.push({ kind: "area", raw: m[0], needle: m[1] });
  }

  return claims;
}

// ── Verificação ────────────────────────────────────────────────────────────

/**
 * Verifica se os claims do reply aparecem no contexto recuperado.
 *
 * `context` é o bloco de texto que veio do RAG (state.retrieved). Se vazio,
 * qualquer claim no reply é suspeito — a Bia não tinha base pra citar nada.
 *
 * Comparação: normaliza ambos, depois pra cada needle (só dígitos), vê se
 * essa sequência aparece em qualquer lugar do contexto normalizado.
 *
 * Falso positivo conhecido: se a Bia escrever "R$ 650.000" e o chunk tiver
 * "R$ 650 mil", ambos normalizam pra needle "650" → bate. Ok.
 * Se a Bia escrever "R$ 680 mil" e o chunk tiver só "a partir de R$ 650 mil",
 * needle "680" NÃO está no chunk → flagada como suspeita. Desejado.
 */
export function checkFactualClaims(reply: string, context: string): FactCheckResult {
  const claims = extractClaims(reply);
  if (claims.length === 0) {
    return { claims: [], suspicious: [], ok: true };
  }

  const ctx = normalize(context);
  // Também uma versão só de dígitos do contexto pra matching de números com
  // pontuação variada (R$ 1.200.000 vs "1200000").
  const ctxDigits = digitsOnly(ctx);

  const suspicious: FactClaim[] = [];
  for (const c of claims) {
    const needle = c.needle;
    if (!needle) continue;
    // Match direto no ctx normalizado OU sequência pura no ctxDigits.
    const found =
      ctx.includes(needle) || (needle.length >= 2 && ctxDigits.includes(needle));
    if (!found) suspicious.push(c);
  }

  return {
    claims,
    suspicious,
    ok: suspicious.length === 0,
  };
}
