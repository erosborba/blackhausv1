/**
 * Unit tests de city-slug (Track 3 · Slice 3.2).
 *
 * Só a parte pura — `cities-fiscal.ts` depende de supabaseAdmin e não
 * entra no Node --strip-types test runner. A lógica de slug é o que
 * importa pra correctness da lookup; o wrapper é thin.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { citySlug, normalizeUf } from "../city-slug.ts";

// ──────────────────────────────────────────────────────────────────────
// citySlug
// ──────────────────────────────────────────────────────────────────────

test("citySlug 1. acento puxa pro ASCII", () => {
  assert.equal(citySlug("São Paulo"), "sao-paulo");
  assert.equal(citySlug("Vitória"), "vitoria");
  assert.equal(citySlug("Maceió"), "maceio");
  assert.equal(citySlug("Goiânia"), "goiania");
  assert.equal(citySlug("Uberlândia"), "uberlandia");
  assert.equal(citySlug("Cuiabá"), "cuiaba");
  assert.equal(citySlug("Niterói"), "niteroi");
  assert.equal(citySlug("Belém"), "belem");
  assert.equal(citySlug("João Pessoa"), "joao-pessoa");
  assert.equal(citySlug("Jaboatão dos Guararapes"), "jaboatao-dos-guararapes");
});

test("citySlug 2. cedilha e til viram ASCII", () => {
  assert.equal(citySlug("Conceição do Mato Dentro"), "conceicao-do-mato-dentro");
  assert.equal(citySlug("Caxias do Sul"), "caxias-do-sul");
});

test("citySlug 3. caixa não importa", () => {
  assert.equal(citySlug("SAO PAULO"), "sao-paulo");
  assert.equal(citySlug("sao paulo"), "sao-paulo");
  assert.equal(citySlug("São PAULO"), "sao-paulo");
});

test("citySlug 4. trim + espaços múltiplos colapsam", () => {
  assert.equal(citySlug("  São   Paulo  "), "sao-paulo");
  assert.equal(citySlug("\tSão\nPaulo\r"), "sao-paulo");
});

test("citySlug 5. pontuação vira dash único", () => {
  assert.equal(citySlug("S. Paulo"), "s-paulo");
  assert.equal(citySlug("Vitória/ES"), "vitoria-es");
  assert.equal(citySlug("São Paulo, SP"), "sao-paulo-sp");
  assert.equal(citySlug("São-Paulo"), "sao-paulo");
});

test("citySlug 6. múltiplos dashes colapsam", () => {
  assert.equal(citySlug("São---Paulo"), "sao-paulo");
  assert.equal(citySlug("--- São Paulo ---"), "sao-paulo");
});

test("citySlug 7. input vazio/nulo não crasha", () => {
  assert.equal(citySlug(""), "");
  // @ts-expect-error — robustez contra chamadas incorretas
  assert.equal(citySlug(null), "");
  // @ts-expect-error
  assert.equal(citySlug(undefined), "");
});

test("citySlug 8. nomes longos preservam ordem dos tokens", () => {
  assert.equal(
    citySlug("São José dos Campos"),
    "sao-jose-dos-campos",
  );
  assert.equal(
    citySlug("São Bernardo do Campo"),
    "sao-bernardo-do-campo",
  );
  assert.equal(
    citySlug("Feira de Santana"),
    "feira-de-santana",
  );
});

test("citySlug 9. dígitos preservados", () => {
  assert.equal(citySlug("Região 4 Sul"), "regiao-4-sul");
});

test("citySlug 10. idempotente (slug de slug = slug)", () => {
  const s1 = citySlug("São Paulo");
  const s2 = citySlug(s1);
  assert.equal(s1, s2);
});

// ──────────────────────────────────────────────────────────────────────
// normalizeUf
// ──────────────────────────────────────────────────────────────────────

test("normalizeUf 1. lowercase vira upper", () => {
  assert.equal(normalizeUf("sp"), "SP");
  assert.equal(normalizeUf("rj"), "RJ");
});

test("normalizeUf 2. trim aplicado", () => {
  assert.equal(normalizeUf("  SP  "), "SP");
  assert.equal(normalizeUf("\tsp\n"), "SP");
});

test("normalizeUf 3. tamanhos inválidos → null", () => {
  assert.equal(normalizeUf("S"), null);
  assert.equal(normalizeUf("SPP"), null);
  assert.equal(normalizeUf(""), null);
});

test("normalizeUf 4. dígitos ou símbolos → null", () => {
  assert.equal(normalizeUf("S1"), null);
  assert.equal(normalizeUf("S-"), null);
  assert.equal(normalizeUf("12"), null);
});

test("normalizeUf 5. null/undefined → null", () => {
  assert.equal(normalizeUf(null), null);
  assert.equal(normalizeUf(undefined), null);
});

test("normalizeUf 6. aceita as 27 UFs (sample)", () => {
  for (const uf of ["SP", "RJ", "MG", "ES", "PR", "SC", "RS", "DF", "GO", "MT", "MS", "BA", "PE", "CE", "RN", "PB", "AL", "SE", "PI", "MA", "AM", "PA", "AC", "RO", "RR", "AP", "TO"]) {
    assert.equal(normalizeUf(uf), uf);
    assert.equal(normalizeUf(uf.toLowerCase()), uf);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Compatibilidade com o seed da migration
// ──────────────────────────────────────────────────────────────────────
// A lookup no DB é por (slug, uf). Se o slug gerado no runtime diverge
// do seed da migration, nada bate. Estes casos congelam o contrato.

test("slug match: capitais do seed", () => {
  const cases: Array<[string, string]> = [
    ["São Paulo", "sao-paulo"],
    ["Rio de Janeiro", "rio-de-janeiro"],
    ["Belo Horizonte", "belo-horizonte"],
    ["Porto Alegre", "porto-alegre"],
    ["Brasília", "brasilia"],
    ["Salvador", "salvador"],
    ["Fortaleza", "fortaleza"],
    ["Recife", "recife"],
    ["Curitiba", "curitiba"],
    ["Manaus", "manaus"],
    ["Belém", "belem"],
    ["Goiânia", "goiania"],
    ["São Luís", "sao-luis"],
    ["Maceió", "maceio"],
    ["Natal", "natal"],
    ["Teresina", "teresina"],
    ["João Pessoa", "joao-pessoa"],
    ["Aracaju", "aracaju"],
    ["Cuiabá", "cuiaba"],
    ["Campo Grande", "campo-grande"],
    ["Florianópolis", "florianopolis"],
    ["Vitória", "vitoria"],
    ["Porto Velho", "porto-velho"],
    ["Rio Branco", "rio-branco"],
    ["Boa Vista", "boa-vista"],
    ["Macapá", "macapa"],
    ["Palmas", "palmas"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(citySlug(input), expected, `slug("${input}")`);
  }
});

test("slug match: metropolitanas do seed", () => {
  const cases: Array<[string, string]> = [
    ["Guarulhos", "guarulhos"],
    ["Campinas", "campinas"],
    ["São José dos Campos", "sao-jose-dos-campos"],
    ["Santo André", "santo-andre"],
    ["São Bernardo do Campo", "sao-bernardo-do-campo"],
    ["Osasco", "osasco"],
    ["Ribeirão Preto", "ribeirao-preto"],
    ["Sorocaba", "sorocaba"],
    ["Niterói", "niteroi"],
    ["Nova Iguaçu", "nova-iguacu"],
    ["Duque de Caxias", "duque-de-caxias"],
    ["Contagem", "contagem"],
    ["Uberlândia", "uberlandia"],
    ["Juiz de Fora", "juiz-de-fora"],
    ["Vila Velha", "vila-velha"],
    ["Londrina", "londrina"],
    ["Maringá", "maringa"],
    ["Caxias do Sul", "caxias-do-sul"],
    ["Pelotas", "pelotas"],
    ["Joinville", "joinville"],
    ["Blumenau", "blumenau"],
    ["Anápolis", "anapolis"],
    ["Feira de Santana", "feira-de-santana"],
    ["Caucaia", "caucaia"],
    ["Jaboatão dos Guararapes", "jaboatao-dos-guararapes"],
    ["Olinda", "olinda"],
    ["Ananindeua", "ananindeua"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(citySlug(input), expected, `slug("${input}")`);
  }
});
