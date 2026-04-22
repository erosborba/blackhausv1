/**
 * Unit tests do classifier de modalidade (Track 4 · Slice 4.3).
 *
 * Cobre: shouldUseAudio (decisão final) + classifyContent (filtro de
 * conteúdo isolado). Ambos são puros — sem I/O, sem mock, só asserção
 * de entrada → saída.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldUseAudio, classifyContent } from "../tts-classify.ts";

// ---------------------------------------------------------------------------
// shouldUseAudio — overrides em cascata
// ---------------------------------------------------------------------------

test("decision 1. lead não prefere áudio → texto (mesmo texto curto)", () => {
  const d = shouldUseAudio({ text: "oi!", leadPrefersAudio: false, source: "llm" });
  assert.equal(d.audio, false);
  assert.equal(d.reason, "lead_prefers_text");
});

test("decision 2. tool output → texto (mesmo que lead prefira áudio)", () => {
  const d = shouldUseAudio({ text: "confirmado", leadPrefersAudio: true, source: "tool" });
  assert.equal(d.audio, false);
  assert.equal(d.reason, "tool_output");
});

test("decision 3. lead prefere + llm + texto curto conversacional → áudio", () => {
  const d = shouldUseAudio({ text: "oi, tudo bem?", leadPrefersAudio: true, source: "llm" });
  assert.equal(d.audio, true);
  assert.equal(d.reason, "ok");
});

// ---------------------------------------------------------------------------
// classifyContent — casos positivos (passa)
// ---------------------------------------------------------------------------

test("content 1. saudação curta → ok", () => {
  assert.deepEqual(classifyContent("oi!"), { audio: true, reason: "ok" });
});

test("content 2. pergunta aberta conversacional → ok", () => {
  assert.deepEqual(classifyContent("faz sentido pro que você tá buscando?"), {
    audio: true,
    reason: "ok",
  });
});

test("content 3. ack curto → ok", () => {
  assert.deepEqual(classifyContent("beleza, vou te mandar já"), {
    audio: true,
    reason: "ok",
  });
});

test("content 4. com vírgula e ponto mas sem estrutura → ok", () => {
  assert.deepEqual(
    classifyContent("então, quer que eu te explique melhor? posso simular pra você"),
    { audio: true, reason: "ok" },
  );
});

// ---------------------------------------------------------------------------
// classifyContent — sinais de rejeição
// ---------------------------------------------------------------------------

test("content 5. vazio → empty", () => {
  assert.equal(classifyContent("").reason, "empty");
  assert.equal(classifyContent("   \n  ").reason, "empty");
});

test("content 6. length > 300 → too_long", () => {
  const long = "a ".repeat(200); // 400 chars
  assert.equal(classifyContent(long).reason, "too_long");
});

test("content 7. 2+ quebras de linha → multiline", () => {
  assert.equal(classifyContent("linha 1\nlinha 2\nlinha 3").reason, "multiline");
});

test("content 8. uma quebra de linha só → passa (não é lista)", () => {
  assert.equal(classifyContent("primeira\nsegunda").audio, true);
});

test("content 9. bullet asterisco no início de linha → bullet", () => {
  // 1 newline (< 2 = abaixo do limite multiline), mas a 2a linha começa
  // com `* ` → sinal bullet catches. Multiline e bullet são independentes.
  assert.equal(classifyContent("olha só:\n* valor legal").reason, "bullet");
  // Isolado numa linha só:
  assert.equal(classifyContent("* valor").reason, "bullet");
});

test("content 10. bullet hífen → bullet", () => {
  assert.equal(classifyContent("- opção 1").reason, "bullet");
});

test("content 11. bullet unicode → bullet", () => {
  assert.equal(classifyContent("• item").reason, "bullet");
});

test("content 12. emoji como bullet no início de linha → bullet", () => {
  assert.equal(classifyContent("💰 bem bacana").reason, "bullet");
});

test("content 13. R$ → currency_symbol", () => {
  assert.equal(classifyContent("a entrada fica em R$ dez mil").reason, "currency_symbol");
});

test("content 14. m² → measurement_unit", () => {
  assert.equal(classifyContent("o studio tem 37 m² bem aproveitados").reason, "measurement_unit");
});

test("content 15. percent → percent", () => {
  assert.equal(classifyContent("fica em torno de 5 ao mês").audio, true);
  assert.equal(classifyContent("fica em torno de 5% ao mês").reason, "percent");
});

test("content 16. 4+ dígitos consecutivos → long_number", () => {
  assert.equal(classifyContent("o código é 12345").reason, "long_number");
});

test("content 17. número com separador de milhar → long_number", () => {
  assert.equal(classifyContent("a parcela fica em 1.404 por mês").reason, "long_number");
});

test("content 18. data dd/mm → date", () => {
  assert.equal(classifyContent("te vejo dia 15/03").reason, "date");
});

test("content 19. data mês abreviado + ano → date", () => {
  assert.equal(classifyContent("entrega em nov/29").reason, "date");
});

test("content 20. mês por extenso → date", () => {
  assert.equal(classifyContent("a entrega é em novembro").reason, "date");
});

test("content 21. endereço com via + número → address", () => {
  assert.equal(classifyContent("fica na Rua XV, 256").reason, "address");
});

test("content 22. endereço genérico palavra-cap + vírgula + número → address", () => {
  assert.equal(
    classifyContent("Alameda Carlos de Carvalho, 256").reason,
    "address",
  );
});

test("content 23. 'oi, tenho 25' NÃO é endereço (evita falso-positivo)", () => {
  // Nome de menos de 4 chars não bate no fallback de address. "Oi" é 2 chars.
  assert.equal(classifyContent("oi, tenho 25").audio, true);
});

// ---------------------------------------------------------------------------
// Caso canônico: bloco AYA que o Eros mostrou
// ---------------------------------------------------------------------------

test("content 24. bloco AYA completo (simulação finance) → rejeita", () => {
  const ayaBlock = `Dan, olha como fica o fluxo na prática com o studio mais em conta que temos no AYA (37m², Centro de Curitiba):

💰 Valor total: R$ 532.935

📅 Durante a obra (entrega nov/29):
* Sinal: R$ 53.294 (1x)
* Mensais: R$ 1.404/mês por 41 meses
* 6 intermediárias de R$ 17.054 (a cada 6 meses)
* Saldo na entrega: ~R$ 319.753 → vai pra financiamento bancário

📍 Localização: Alameda Carlos de Carvalho, 256 — coração do Centro

🎯 Retorno estimado (locação):
Studios bem localizados no Centro de Curitiba costumam render entre 0,5% e 0,6% ao mês sobre o valor do imóvel. Isso representa aproximadamente R$ 2.600–3.200/mês de aluguel quando o imóvel estiver pronto — suficiente pra cobrir o financiamento e ainda sobrar.

⚠️ Essa é uma estimativa de mercado, não garantia — o consultor pode detalhar melhor quando chegar a hora.

Faz sentido pro que você tá buscando?`;

  const d = classifyContent(ayaBlock);
  assert.equal(d.audio, false);
  // Tantos sinais batem que não garantimos qual vai primeiro, mas TEM que
  // cair em algum dos esperados.
  const expected = new Set([
    "too_long",
    "multiline",
    "bullet",
    "currency_symbol",
    "measurement_unit",
    "percent",
    "long_number",
    "date",
    "address",
  ]);
  assert.ok(expected.has(d.reason), `reason inesperada: ${d.reason}`);
});

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

test("content 25. determinismo — mesmo input = mesmo output", () => {
  const a = classifyContent("oi, tudo bem?");
  const b = classifyContent("oi, tudo bem?");
  assert.deepEqual(a, b);
});

test("content 26. trim não vaza — 'R$ 10' com espaços ainda rejeita", () => {
  assert.equal(classifyContent("   R$ 10   ").reason, "currency_symbol");
});
