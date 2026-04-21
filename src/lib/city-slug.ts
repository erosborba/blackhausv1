/**
 * Vanguard · Track 3 · Slice 3.2 — normalizador de nome de cidade.
 *
 * Lookup na `cities_fiscal` é por slug normalizado pra tolerar
 * variações de usuário ("São Paulo", "sao paulo", "SAO PAULO", "S. Paulo"
 * no limite razoável). Slug = lowercase, sem acento, espaços/pontuação
 * viram '-', múltiplos dashes colapsam, trim.
 *
 * Mantido puro (sem deps externas) pra ser testável e reutilizável em
 * qualquer runtime — Node, edge, browser.
 */

/**
 * Remove acentos usando normalização Unicode NFD + filtra diacríticos.
 * Funciona pra português, espanhol, francês básicos.
 */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Converte um nome de cidade em slug pra busca na `cities_fiscal`.
 *
 * Exemplos:
 *   "São Paulo"              → "sao-paulo"
 *   "  São  Paulo  "         → "sao-paulo"
 *   "São José dos Campos"    → "sao-jose-dos-campos"
 *   "Jaboatão dos Guararapes"→ "jaboatao-dos-guararapes"
 *   "Vitória/ES"             → "vitoria-es"   (caller deve separar UF antes)
 *   ""                       → ""
 */
export function citySlug(input: string): string {
  if (!input) return "";
  return stripAccents(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normaliza UF pra char(2) maiúsculo. Retorna null se inválido.
 * Não valida contra lista fechada — só forma; a lookup lida com UF
 * inexistente retornando null (miss).
 */
export function normalizeUf(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return null;
  return trimmed;
}
