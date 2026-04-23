import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { env } from "./env";
import { anthropicUsage, logUsage } from "./ai-usage";

/**
 * Parser de tabela de preços imobiliária (PDF/XLSX/CSV) via Claude.
 *
 * Porque não regex: tabelas variam entre construtoras em # de parcelas,
 * datas de reforço, nomes de tipologia ("2QS Flex Plex"), presença de
 * terraço, linhas de loja misturadas com residencial, merged cells em
 * XLSX, rodapés com disclaimers. Claude com `document` block nativo +
 * schema rígido resolve com custo ~$0.02/upload.
 *
 * Saída: estrutura pronta pra persistir em `unidades` (source='tabela_precos')
 * + metadata em `empreendimento_tabelas_precos`. NÃO grava no banco —
 * responsabilidade do caller (ver `tabela-precos.ts`).
 */

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

// ─── tipos públicos ──────────────────────────────────────────────────────────

export type ParsedUnidade = {
  numero: string;
  andar: number | null;
  tipologia: string;
  area_privativa: number | null;
  area_terraco: number | null;
  preco_total: number;
  plano_pagamento: {
    sinal: { parcelas: number; valor: number };
    mensais: { parcelas: number; valor: number };
    reforcos: Array<{ data: string; valor: number }>;
    saldo_final: { data: string | null; valor: number };
  };
  is_comercial: boolean;
};

export type ParsedTabelaPrecos = {
  tipologias_encontradas: string[];
  disclaimers: string[];
  entrega_prevista: string | null;
  unidades: ParsedUnidade[];
  /** Warnings de validação aritmética + unidades descartadas por schema inválido. */
  warnings: ParseWarning[];
  /** Metadados do arquivo (pra gravar em empreendimento_tabelas_precos). */
  file: { name: string; mime: string; hash: string; bytes: number };
};

export type ParseWarning = {
  numero: string | null;
  kind: "aritmetica" | "schema" | "duplicado";
  detalhe: string;
  soma_calc?: number;
  preco_total?: number;
  diff?: number;
};

// ─── validação aritmética (lote com tolerância 0.1% ou R$100 — o maior) ─────

const TOLERANCE_PCT = 0.001; // 0.1%
const TOLERANCE_ABS = 100; // R$ 100

/**
 * Valida que a soma do plano bate com preco_total dentro da tolerância.
 * Retorna {ok, soma_calc, diff} pra caller decidir (incluir vs warn vs drop).
 */
export function validarAritmetica(u: ParsedUnidade): {
  ok: boolean;
  soma_calc: number;
  diff: number;
  tolerancia_aplicada: number;
} {
  const pp = u.plano_pagamento;
  const soma_calc =
    pp.sinal.parcelas * pp.sinal.valor +
    pp.mensais.parcelas * pp.mensais.valor +
    pp.reforcos.reduce((acc, r) => acc + (r.valor || 0), 0) +
    pp.saldo_final.valor;
  const diff = Math.abs(soma_calc - u.preco_total);
  const tolerancia_aplicada = Math.max(u.preco_total * TOLERANCE_PCT, TOLERANCE_ABS);
  return { ok: diff <= tolerancia_aplicada, soma_calc, diff, tolerancia_aplicada };
}

// ─── helpers de input ────────────────────────────────────────────────────────

type AnthropicContent =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
      title?: string;
    };

async function xlsxToText(buf: Buffer, name: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const lines: string[] = [`=== Arquivo: ${name} ===`];
  wb.eachSheet((sheet) => {
    lines.push(`-- Aba: ${sheet.name} --`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        if (v === null || v === undefined) {
          cells.push("");
        } else if (typeof v === "object" && "text" in (v as object)) {
          cells.push(String((v as { text: unknown }).text ?? ""));
        } else if (typeof v === "object" && "result" in (v as object)) {
          // Fórmula: pega o cached result.
          cells.push(String((v as { result: unknown }).result ?? ""));
        } else {
          cells.push(String(v));
        }
      });
      lines.push(cells.join(" | "));
    });
  });
  return lines.join("\n");
}

function csvToText(buf: Buffer, name: string): string {
  const text = buf.toString("utf8");
  return `=== Arquivo: ${name} (CSV) ===\n${text}`;
}

function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

// ─── parser principal ────────────────────────────────────────────────────────

export type ParserInput = {
  file: File | { name: string; mime: string; bytes: Buffer };
  empreendimentoId?: string | null;
};

/**
 * Lê o arquivo, chama Claude com o schema, valida aritmeticamente,
 * retorna estrutura pronta pra persistir. Não toca em banco.
 */
export async function parseTabelaPrecos(input: ParserInput): Promise<ParsedTabelaPrecos> {
  const { bytes, name, mime } = await normalizeInput(input.file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ext = extOf(name);

  const content: AnthropicContent[] = [];

  if (mime === "application/pdf" || ext === "pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: bytes.toString("base64"),
      },
      title: name,
    });
  } else if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) {
    const sheetText = await xlsxToText(bytes, name);
    content.push({
      type: "text",
      text: `Conteúdo de planilha (colunas separadas por " | "):\n\n${sheetText}`,
    });
  } else if (ext === "csv" || mime === "text/csv") {
    content.push({ type: "text", text: csvToText(bytes, name) });
  } else {
    throw new Error(`formato não suportado: ${name} (mime=${mime}, ext=${ext})`);
  }

  content.push({
    type: "text",
    text: "Extraia todas as unidades conforme o schema e retorne APENAS o JSON.",
  });

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let jsonText = "";
  try {
    // Streaming obrigatório: output de ~30k+ tokens estoura o limite de
    // ~10min do messages.create síncrono. `finalMessage()` coleta tudo e
    // devolve o shape idêntico ao .create.
    const stream = anthropic.messages.stream({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 48000,
      // Tabelas grandes (AYA Amintas tem ~130 unidades e gerou ~32k
      // tokens de saída em teste — cortou no último item). 48k dá
      // folga pra empreendimentos na faixa de 180 unidades. Sonnet 4.6
      // aceita até 64k se ainda não for suficiente.
      system: PARSER_SYSTEM,
      messages: [{ role: "user", content: content as never }],
    });
    const resp = await stream.finalMessage();
    jsonText = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const u = anthropicUsage(resp);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "tabela_precos_parse",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      durationMs: Date.now() - t0,
      empreendimentoId: input.empreendimentoId ?? null,
      metadata: { file: name, bytes: bytes.byteLength, mime },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "tabela_precos_parse",
      durationMs: Date.now() - t0,
      empreendimentoId: input.empreendimentoId ?? null,
      ok: false,
      error: msg,
      metadata: { file: name, bytes: bytes.byteLength, mime },
    });
    throw new Error(`parser: claude falhou: ${msg}`);
  }

  const cleaned = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  let parsed: unknown;
  try {
    parsed = JSON.parse(match ? match[0] : cleaned);
  } catch (e) {
    throw new Error(
      `parser: JSON inválido do Claude: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return validarEmontar(parsed, { name, mime, hash, bytes: bytes.byteLength });
}

// ─── validação + montagem ────────────────────────────────────────────────────

function validarEmontar(
  raw: unknown,
  fileMeta: { name: string; mime: string; hash: string; bytes: number },
): ParsedTabelaPrecos {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const warnings: ParseWarning[] = [];
  const unidades: ParsedUnidade[] = [];
  const seen = new Set<string>();

  const rawUnidades = Array.isArray(obj.unidades) ? obj.unidades : [];
  for (const r of rawUnidades) {
    const check = toUnidade(r);
    if (check.kind === "invalid") {
      warnings.push({ numero: check.numero, kind: "schema", detalhe: check.reason });
      continue;
    }
    const u = check.unidade;
    const key = u.numero.toLowerCase();
    if (seen.has(key)) {
      warnings.push({
        numero: u.numero,
        kind: "duplicado",
        detalhe: "unidade com número duplicado na tabela; mantendo a primeira",
      });
      continue;
    }
    seen.add(key);
    const arit = validarAritmetica(u);
    if (!arit.ok) {
      warnings.push({
        numero: u.numero,
        kind: "aritmetica",
        detalhe: `soma do plano (${arit.soma_calc.toFixed(2)}) diverge do total (${u.preco_total.toFixed(2)}) em R$ ${arit.diff.toFixed(2)} — tolerância R$ ${arit.tolerancia_aplicada.toFixed(2)}`,
        soma_calc: arit.soma_calc,
        preco_total: u.preco_total,
        diff: arit.diff,
      });
      // Inclui mesmo assim: a Bia vai citar valores do bloco com
      // disclaimer. Dropar linhas silenciosamente seria pior UX.
    }
    unidades.push(u);
  }

  const tipologias_encontradas = Array.isArray(obj.tipologias_encontradas)
    ? (obj.tipologias_encontradas as unknown[]).filter((x): x is string => typeof x === "string")
    : Array.from(new Set(unidades.map((u) => u.tipologia)));

  const disclaimers = Array.isArray(obj.disclaimers)
    ? (obj.disclaimers as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 12)
    : [];

  const entrega_prevista =
    typeof obj.entrega_prevista === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.entrega_prevista)
      ? obj.entrega_prevista
      : null;

  return {
    tipologias_encontradas,
    disclaimers,
    entrega_prevista,
    unidades,
    warnings,
    file: fileMeta,
  };
}

type UnidadeCheck =
  | { kind: "ok"; unidade: ParsedUnidade }
  | { kind: "invalid"; numero: string | null; reason: string };

function toUnidade(raw: unknown): UnidadeCheck {
  if (!raw || typeof raw !== "object") {
    return { kind: "invalid", numero: null, reason: "não é objeto" };
  }
  const r = raw as Record<string, unknown>;
  const numero = typeof r.numero === "string" ? r.numero.trim() : null;
  if (!numero) return { kind: "invalid", numero: null, reason: "numero ausente" };

  const tipologia = typeof r.tipologia === "string" ? r.tipologia.trim() : "";
  if (!tipologia) return { kind: "invalid", numero, reason: "tipologia ausente" };

  const preco_total = toNum(r.preco_total);
  if (preco_total == null || preco_total <= 0) {
    return { kind: "invalid", numero, reason: "preco_total inválido" };
  }

  const pp = (r.plano_pagamento ?? {}) as Record<string, unknown>;
  const sinal = (pp.sinal ?? {}) as Record<string, unknown>;
  const mensais = (pp.mensais ?? {}) as Record<string, unknown>;
  const saldo = (pp.saldo_final ?? {}) as Record<string, unknown>;

  const reforcosRaw = Array.isArray(pp.reforcos) ? (pp.reforcos as unknown[]) : [];
  const reforcos: Array<{ data: string; valor: number }> = [];
  for (const rr of reforcosRaw) {
    if (!rr || typeof rr !== "object") continue;
    const x = rr as Record<string, unknown>;
    const valor = toNum(x.valor);
    const data = typeof x.data === "string" ? x.data : null;
    if (valor == null || !data) continue;
    reforcos.push({ data, valor });
  }

  const unidade: ParsedUnidade = {
    numero,
    andar: toInt(r.andar),
    tipologia,
    area_privativa: toNum(r.area_privativa),
    area_terraco: toNum(r.area_terraco),
    preco_total,
    plano_pagamento: {
      sinal: {
        parcelas: toInt(sinal.parcelas) ?? 1,
        valor: toNum(sinal.valor) ?? 0,
      },
      mensais: {
        parcelas: toInt(mensais.parcelas) ?? 0,
        valor: toNum(mensais.valor) ?? 0,
      },
      reforcos,
      saldo_final: {
        data: typeof saldo.data === "string" ? saldo.data : null,
        valor: toNum(saldo.valor) ?? 0,
      },
    },
    is_comercial: Boolean(r.is_comercial),
  };
  return { kind: "ok", unidade };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n == null ? null : Math.trunc(n);
}

async function normalizeInput(
  f: File | { name: string; mime: string; bytes: Buffer },
): Promise<{ bytes: Buffer; name: string; mime: string }> {
  if (f instanceof File) {
    return {
      bytes: Buffer.from(await f.arrayBuffer()),
      name: f.name,
      mime: f.type || "",
    };
  }
  return { bytes: f.bytes, name: f.name, mime: f.mime };
}
