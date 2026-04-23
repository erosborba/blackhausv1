#!/usr/bin/env node
/**
 * Bootstrap: parseia o PDF de tabela de preços do AYA Amintas e popula
 * `unidades` + `empreendimento_tabelas_precos`. Operação one-off.
 *
 * Replica a lógica de `src/lib/tabela-precos-parser.ts` +
 * `src/lib/tabela-precos.ts` inline pra evitar dependência de
 * --experimental-strip-types com imports implícitos. O pipeline real
 * (UI + API) usa as libs de verdade; aqui é só bootstrap.
 *
 * Uso:
 *   node scripts/apply-tabela-precos-aya.mjs [caminho/para/tabela.pdf]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";

const EMPREENDIMENTO_ID = "b9be8bc1-1877-48c6-b4b6-b510e851e4b4";
const pdfPath = process.argv[2] || "/home/eros/Downloads/Tabela AYA Amintas ABRIL 2026.pdf";
const absPath = resolve(pdfPath);

const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL = "claude-sonnet-4-6", SUPABASE_DB_URL } = process.env;
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY faltando"); process.exit(1); }
if (!SUPABASE_DB_URL) { console.error("SUPABASE_DB_URL faltando"); process.exit(1); }

const PARSER_SYSTEM = `Você é um parser de tabelas de preços de empreendimentos imobiliários brasileiros.

Recebe um PDF, texto de planilha (XLSX/CSV) ou combinação dos dois. Extrai TODAS as unidades listadas com seu plano de pagamento completo.

Retorne APENAS um objeto JSON puro (sem markdown, sem fences), no schema:

{
  "tipologias_encontradas": string[],
  "disclaimers": string[],
  "entrega_prevista": string | null,
  "unidades": [
    {
      "numero": string,
      "andar": number | null,
      "tipologia": string,
      "area_privativa": number | null,
      "area_terraco": number | null,
      "preco_total": number,
      "plano_pagamento": {
        "sinal": { "parcelas": number, "valor": number },
        "mensais": { "parcelas": number, "valor": number },
        "reforcos": [ { "data": string, "valor": number } ],
        "saldo_final": { "data": string | null, "valor": number }
      },
      "is_comercial": boolean
    }
  ]
}

Regras duras:
- "numero": exatamente como aparece na tabela ("1811", "L01", "301").
- "andar": infira dos dois últimos dígitos do número quando o padrão for "<andar><unidade>" (1811→18, 301→3, 2908→29). Lojas e casos ambíguos → null. NUNCA invente.
- "tipologia": valor normalizado da coluna "Tipologia". Preserve rótulo ("Studio", "1Q", "2Q", "Studio Plex", "2QS Flex", "2QS Flex Plex", "Loja"). Não traduza, não expanda, não crie rótulo que não exista na tabela.
- "area_privativa" / "area_terraco": número em m² (sem unidade, sem string). Se não tiver terraço, 0.
- "preco_total": número em R$ (sem símbolo, sem pontuação). Ex: 393714.73.
- "plano_pagamento.sinal": quantidade de parcelas de sinal (geralmente 1) + valor unitário.
- "plano_pagamento.mensais": quantidade de parcelas mensais + valor unitário. Ex: 47 × R$ 754,00.
- "plano_pagamento.reforcos": uma entrada por reforço semestral. "data": "YYYY-MM-DD" (use dia 01 quando só tiver mês/ano, ex: "dez/26" → "2026-12-01"; "jun/27" → "2027-06-01").
- "plano_pagamento.saldo_final.data": mês da entrega em YYYY-MM-DD (dia 01). Se não tiver mês específico, null.
- "is_comercial": true se for loja/comercial (numeração "L01", "L02", tipologia "LOJA"/"SALA COMERCIAL"), false caso contrário.

Regras do cabeçalho:
- "tipologias_encontradas": lista distinta de tipologias que aparecem em "unidades". Ordem de primeira aparição.
- "disclaimers": strings livres do rodapé/notas (ex: "Entrega em 31/03/2030", "Saldo devedor corrigido pelo INCC até a entrega das chaves", "Comissão 4%"). Mantenha PALAVRA-POR-PALAVRA o essencial, até 12 itens.
- "entrega_prevista": YYYY-MM-DD detectada no rodapé ("Entrega em 31/03/2030" → "2030-03-31"). Null se não achar.

CRÍTICO — validação aritmética:
- Pra cada unidade, confira internamente:
    soma_calc = sinal.parcelas × sinal.valor
              + mensais.parcelas × mensais.valor
              + Σ reforcos.valor
              + saldo_final.valor
  DEVE ficar a ±0.1% ou ±R$ 100 de preco_total (o que for maior). Se não bater, ainda assim inclua a unidade com os valores que você conseguiu ler — não invente, não "corrija" pra fechar.
- Nunca arredonde preço por conta própria. Copie o número da tabela.
- Se um valor estiver ilegível/ausente, use 0 — o caller detecta discrepância na validação.

Retorne o JSON e nada mais.`;

const TOLERANCE_PCT = 0.001;
const TOLERANCE_ABS = 100;

function validarAritmetica(u) {
  const pp = u.plano_pagamento;
  const soma_calc =
    pp.sinal.parcelas * pp.sinal.valor +
    pp.mensais.parcelas * pp.mensais.valor +
    pp.reforcos.reduce((a, r) => a + (r.valor || 0), 0) +
    pp.saldo_final.valor;
  const diff = Math.abs(soma_calc - u.preco_total);
  const tol = Math.max(u.preco_total * TOLERANCE_PCT, TOLERANCE_ABS);
  return { ok: diff <= tol, soma_calc, diff, tolerancia: tol };
}

function inferAndar(numero) {
  const d = String(numero).replace(/\D/g, "");
  if (!d || d.length < 3) return null;
  const a = Number(d.slice(0, -2));
  return Number.isFinite(a) && a > 0 ? a : null;
}

// ─── parse ───────────────────────────────────────────────────────────────────

const buf = readFileSync(absPath);
const fileName = absPath.split("/").pop();
const hash = createHash("sha256").update(buf).digest("hex");

console.log(`[aya] parseando ${fileName} (${(buf.length / 1024).toFixed(1)} KB) com ${ANTHROPIC_MODEL}...`);
const t0 = Date.now();

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
// Streaming: a resposta completa passa de 30k output tokens e o SDK
// bloqueia `messages.create` síncrono acima de ~10min.
const stream = anthropic.messages.stream({
  model: ANTHROPIC_MODEL,
  max_tokens: 48000,
  system: PARSER_SYSTEM,
  messages: [{
    role: "user",
    content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: fileName },
      { type: "text", text: "Extraia todas as unidades conforme o schema e retorne APENAS o JSON." },
    ],
  }],
});
const resp = await stream.finalMessage();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[aya] parser terminou em ${elapsed}s — stop_reason=${resp.stop_reason} usage=${JSON.stringify(resp.usage)}`);
if (resp.stop_reason === "max_tokens") {
  console.error(`[aya] FATAL: saída truncada por max_tokens. Suba o limite no script.`);
  process.exit(1);
}
const jsonText = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
const cleaned = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
const match = cleaned.match(/\{[\s\S]*\}/);
let obj;
try {
  obj = JSON.parse(match ? match[0] : cleaned);
} catch (e) {
  console.error(`[aya] FATAL: JSON inválido do Claude — ${e.message}. Primeiros 500 chars:\n${cleaned.slice(0, 500)}`);
  process.exit(1);
}

const rawUnidades = Array.isArray(obj.unidades) ? obj.unidades : [];
const warnings = [];
const unidades = [];
const seen = new Set();

for (const r of rawUnidades) {
  if (!r || typeof r !== "object") { warnings.push({ numero: null, kind: "schema", detalhe: "não é objeto" }); continue; }
  const numero = typeof r.numero === "string" ? r.numero.trim() : null;
  if (!numero) { warnings.push({ numero: null, kind: "schema", detalhe: "numero ausente" }); continue; }
  const tipologia = typeof r.tipologia === "string" ? r.tipologia.trim() : "";
  if (!tipologia) { warnings.push({ numero, kind: "schema", detalhe: "tipologia ausente" }); continue; }
  const preco_total = Number(r.preco_total);
  if (!Number.isFinite(preco_total) || preco_total <= 0) {
    warnings.push({ numero, kind: "schema", detalhe: "preco_total inválido" });
    continue;
  }
  const pp = r.plano_pagamento ?? {};
  const sinal = pp.sinal ?? {};
  const mensais = pp.mensais ?? {};
  const saldo = pp.saldo_final ?? {};
  const reforcos = (Array.isArray(pp.reforcos) ? pp.reforcos : [])
    .filter((x) => x && typeof x === "object" && typeof x.data === "string" && Number.isFinite(Number(x.valor)))
    .map((x) => ({ data: x.data, valor: Number(x.valor) }));

  const u = {
    numero,
    andar: Number.isFinite(Number(r.andar)) ? Math.trunc(Number(r.andar)) : null,
    tipologia,
    area_privativa: Number.isFinite(Number(r.area_privativa)) ? Number(r.area_privativa) : null,
    area_terraco: Number.isFinite(Number(r.area_terraco)) ? Number(r.area_terraco) : null,
    preco_total,
    plano_pagamento: {
      sinal: { parcelas: Number(sinal.parcelas) || 1, valor: Number(sinal.valor) || 0 },
      mensais: { parcelas: Number(mensais.parcelas) || 0, valor: Number(mensais.valor) || 0 },
      reforcos,
      saldo_final: { data: typeof saldo.data === "string" ? saldo.data : null, valor: Number(saldo.valor) || 0 },
    },
    is_comercial: Boolean(r.is_comercial),
  };

  const key = numero.toLowerCase();
  if (seen.has(key)) { warnings.push({ numero, kind: "duplicado", detalhe: "duplicado; mantém primeira" }); continue; }
  seen.add(key);

  const arit = validarAritmetica(u);
  if (!arit.ok) {
    warnings.push({
      numero,
      kind: "aritmetica",
      detalhe: `soma ${arit.soma_calc.toFixed(2)} vs total ${preco_total.toFixed(2)}, diff R$ ${arit.diff.toFixed(2)} (tol ${arit.tolerancia.toFixed(2)})`,
      soma_calc: arit.soma_calc,
      preco_total,
      diff: arit.diff,
    });
  }
  unidades.push(u);
}

const tipologias_encontradas = Array.isArray(obj.tipologias_encontradas)
  ? obj.tipologias_encontradas.filter((x) => typeof x === "string")
  : Array.from(new Set(unidades.map((u) => u.tipologia)));
const disclaimers = Array.isArray(obj.disclaimers)
  ? obj.disclaimers.filter((x) => typeof x === "string").slice(0, 12)
  : [];
const entrega_prevista = typeof obj.entrega_prevista === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.entrega_prevista)
  ? obj.entrega_prevista
  : null;

console.log(`[aya] unidades válidas: ${unidades.length} / rawCount=${rawUnidades.length}`);
console.log(`[aya] tipologias: ${tipologias_encontradas.join(", ")}`);
console.log(`[aya] entrega: ${entrega_prevista}`);
console.log(`[aya] disclaimers (${disclaimers.length}):`);
for (const d of disclaimers) console.log(`        · ${d}`);
console.log(`[aya] warnings (${warnings.length}):`);
for (const w of warnings) console.log(`        ⚠ ${w.numero ?? "?"} [${w.kind}]: ${w.detalhe}`);

const sample = unidades.find((u) => u.numero === "1811");
if (!sample) { console.error("[aya] FATAL: não achou unidade 1811 na extração"); process.exit(1); }
console.log(`[aya] amostra 1811:\n${JSON.stringify(sample, null, 2)}`);

// Sanity: 1812 também
const s1812 = unidades.find((u) => u.numero === "1812");
if (s1812) console.log(`[aya] amostra 1812: R$ ${s1812.preco_total} (tipologia=${s1812.tipologia})`);

// ─── persiste ────────────────────────────────────────────────────────────────

const client = new pg.Client({ connectionString: SUPABASE_DB_URL });
await client.connect();
try {
  const hdrR = await client.query(
    `select version from public.empreendimento_tabelas_precos where empreendimento_id = $1`,
    [EMPREENDIMENTO_ID],
  );
  const currentVersion = hdrR.rows[0] ? Number(hdrR.rows[0].version) : 0;
  const newVersion = currentVersion + 1;
  console.log(`[aya] currentVersion=${currentVersion}, persistindo como v${newVersion}...`);

  // Carrega existing unidades pra detectar órfãs e preservar manual.
  const existing = await client.query(
    `select id, numero, source, status, notes, tabela_precos_version
     from public.unidades where empreendimento_id = $1`,
    [EMPREENDIMENTO_ID],
  );
  const byNumero = new Map(existing.rows.map((r) => [r.numero.toLowerCase(), r]));

  let inserted = 0, updated = 0, preserved_manual = 0;
  const parsedKeys = new Set();

  await client.query("begin");
  try {
    for (const u of unidades) {
      const key = u.numero.toLowerCase();
      parsedKeys.add(key);
      const prior = byNumero.get(key);

      if (prior && prior.source === "manual") { preserved_manual++; continue; }

      const andar = u.andar ?? inferAndar(u.numero);
      if (prior) {
        await client.query(
          `update public.unidades set
             andar=$1, tipologia=$2, tipologia_ref=$3, area_privativa=$4, area_terraco=$5,
             preco_total=$6, preco=$7, plano_pagamento=$8::jsonb,
             is_comercial=$9, source='tabela_precos', raw_row=$10::jsonb,
             tabela_precos_version=$11
           where id=$12`,
          [andar, u.tipologia, u.tipologia, u.area_privativa, u.area_terraco,
           u.preco_total, u.preco_total, JSON.stringify(u.plano_pagamento),
           u.is_comercial, JSON.stringify(u), newVersion, prior.id],
        );
        updated++;
      } else {
        await client.query(
          `insert into public.unidades
             (empreendimento_id, andar, numero, tipologia, tipologia_ref,
              area_privativa, area_terraco, preco_total, preco, plano_pagamento,
              status, is_comercial, source, raw_row, tabela_precos_version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'avail',$11,'tabela_precos',$12::jsonb,$13)`,
          [EMPREENDIMENTO_ID, andar, u.numero, u.tipologia, u.tipologia,
           u.area_privativa, u.area_terraco, u.preco_total, u.preco_total,
           JSON.stringify(u.plano_pagamento), u.is_comercial, JSON.stringify(u), newVersion],
        );
        inserted++;
      }
    }

    // Órfãs
    let orphaned = 0;
    for (const prior of existing.rows) {
      if (prior.source !== "tabela_precos") continue;
      if (parsedKeys.has(prior.numero.toLowerCase())) continue;
      const noteMark = `[removida do upload v${newVersion} em ${new Date().toISOString().slice(0,10)}]`;
      const newNotes = prior.notes ? `${prior.notes}\n${noteMark}` : noteMark;
      await client.query(
        `update public.unidades set status='unavailable', notes=$1 where id=$2`,
        [newNotes, prior.id],
      );
      orphaned++;
    }

    if (hdrR.rows[0]) {
      await client.query(
        `update public.empreendimento_tabelas_precos set
           version=$1, file_path=null, file_name=$2, file_hash=$3, file_mime=$4,
           entrega_prevista=$5, disclaimers=$6::jsonb, parse_warnings=$7::jsonb,
           parsed_rows_count=$8, uploaded_at=now(), uploaded_by=$9
         where empreendimento_id=$10 and version=$11`,
        [newVersion, fileName, hash, "application/pdf", entrega_prevista,
         JSON.stringify(disclaimers), JSON.stringify(warnings),
         unidades.length, "script:apply-tabela-precos-aya", EMPREENDIMENTO_ID, currentVersion],
      );
    } else {
      await client.query(
        `insert into public.empreendimento_tabelas_precos
           (empreendimento_id, version, file_path, file_name, file_hash, file_mime,
            entrega_prevista, disclaimers, parse_warnings, parsed_rows_count, uploaded_by)
         values ($1,$2,null,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
        [EMPREENDIMENTO_ID, newVersion, fileName, hash, "application/pdf",
         entrega_prevista, JSON.stringify(disclaimers), JSON.stringify(warnings),
         unidades.length, "script:apply-tabela-precos-aya"],
      );
    }

    await client.query("commit");
    console.log(`[aya] ✓ OK  inserted=${inserted}  updated=${updated}  preserved_manual=${preserved_manual}  orphaned=${orphaned}  version=${newVersion}`);
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
} finally {
  await client.end();
}
