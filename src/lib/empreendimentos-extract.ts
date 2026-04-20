import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { env } from "./env";
import { supabaseAdmin } from "./supabase";
import type { ExtractedData, Midia, RawKnowledge } from "./empreendimentos";
import { anthropicUsage, logUsage } from "./ai-usage";

/**
 * Extração de dados estruturados a partir de arquivos (PDF/XLSX/imagens).
 *
 * Chamada em dois lugares:
 *  - /api/admin/empreendimentos/extract  (wizard de criação)
 *  - /api/admin/empreendimentos/[id]/docs (adicionar docs a empreendimento existente)
 *
 * Faz upload no storage, monta os blocos pro Claude, pede JSON estruturado
 * e devolve os dados. Não salva nada em `empreendimentos` — isso é
 * responsabilidade dos callers.
 */

const EXTRACT_SYSTEM = `Você é um assistente que processa documentos imobiliários (descritivos PDF, tabelas XLSX, fotos) pra alimentar um CRM + base de conhecimento de IA.

Você devolve DUAS coisas no mesmo JSON:
  1. \`structured\` — dados tabulares pro cadastro do empreendimento.
  2. \`raw_chunks\` — trechos semanticamente segmentados do conteúdo dos docs, pra alimentar o RAG (a Bia usar quando o corretor perguntar coisas específicas não cobertas pelos campos estruturados, tipo "tem piso laminado?", "paredes são de drywall?", "qual a garantia da fachada?").

Retorne APENAS um objeto JSON puro (sem markdown, sem fences).

Schema:

{
  "structured": {
    "nome": string | null,
    "construtora": string | null,
    "status": "lancamento" | "em_obras" | "pronto_para_morar" | null,
    "endereco": string | null,
    "bairro": string | null,
    "cidade": string | null,
    "estado": string | null,
    "preco_inicial": number | null,
    "entrega": string | null,
    "tipologias": [{ "quartos": number, "suites": number?, "vagas": number?, "area": number, "preco": number }],
    "diferenciais": string[],
    "lazer": string[],
    "descricao": string | null
  },
  "raw_chunks": [
    { "section": string, "text": string, "source_file": string }
  ]
}

Regras do \`structured\`:
- preco_inicial: menor preço em BRL encontrado (só o número).
- entrega: YYYY-MM-DD; se só tiver mês/ano, use dia 01.
- estado: sigla UF (ex: PR, SC, SP).
- descricao: resumo curto (3-5 frases) juntando localização, público-alvo e destaques.
- tipologias: uma entrada por variação de planta. "area" em m². Se valores variam, use o mínimo.
- diferenciais/lazer: itens curtos (1-3 palavras), sem pontuação final. NÃO inclua aqui coisa que já está detalhada nos raw_chunks (ex.: "memorial descritivo" não é diferencial).
- Se um campo não estiver nos documentos: null pra string/number, [] pra array. NÃO INVENTE.

Regras do \`raw_chunks\`:
- Cada chunk é um bloco semanticamente coeso (uma seção de memorial descritivo, uma tabela de acabamentos por ambiente, regras de financiamento, garantias, etc).
- \`section\`: rótulo curto (2-4 palavras) categorizando o conteúdo. Exemplos: "Acabamentos", "Fachada", "Memorial descritivo", "Financiamento", "Vagas de garagem", "Áreas comuns detalhadas", "Unidades - dimensões", "Garantias", "Infraestrutura".
- \`text\`: mantenha PALAVRAS-CHAVE do original (preços exatos, medidas, marcas, materiais, cláusulas). NÃO parafraseie perdendo termos técnicos. Max ~400 palavras por chunk; se um bloco é maior, quebre em chunks menores com mesmo \`section\`.
- \`source_file\`: nome do arquivo onde aparece (use o título do documento como referência).
- Foque em conteúdo que um corretor precisaria responder a cliente. Ignore capas, índices, rodapés legais genéricos, disclaimers de compliance.
- Se os docs não têm conteúdo extra além dos campos estruturados (ex.: só subiu uma foto), retorne \`raw_chunks: []\`.`;

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
      title?: string;
    }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export type ExtractResult = {
  uploaded: Midia[];
  extracted: ExtractedData;
  rawChunks: RawKnowledge[];
};

export type ExtractError = {
  ok: false;
  stage: "upload" | "claude" | "parse";
  error: string;
  raw?: string;
  uploaded: Midia[];
};

/**
 * Processa uma lista de arquivos: sobe no Supabase storage em `prefix/`,
 * manda pro Claude pra extrair JSON, devolve os paths uploaded + dados.
 *
 * `prefix` é o prefixo de path no bucket "empreendimentos" (ex.:
 * `draft/abc123` ou `emp/uuid-do-empreendimento`).
 */
export async function extractFromFiles(
  files: File[],
  prefix: string,
): Promise<{ ok: true; result: ExtractResult } | ExtractError> {
  if (!files.length) {
    return { ok: false, stage: "upload", error: "no files provided", uploaded: [] };
  }

  const sb = supabaseAdmin();
  const uploaded: Midia[] = [];
  const content: ContentBlock[] = [];
  const sheetTexts: string[] = [];
  const nowIso = new Date().toISOString();

  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${prefix}/${safeName}`;

    const { error: upErr } = await sb.storage.from("empreendimentos").upload(path, buf, {
      contentType: file.type || undefined,
      upsert: true,
    });
    if (upErr) {
      return {
        ok: false,
        stage: "upload",
        error: `upload falhou (${file.name}): ${upErr.message}`,
        uploaded,
      };
    }

    if (file.type === "application/pdf" || ext === "pdf") {
      uploaded.push({ type: "pdf", name: file.name, path, size: buf.byteLength, added_at: nowIso });
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
        title: file.name,
      });
    } else if (
      ext === "xlsx" ||
      ext === "xls" ||
      file.type.includes("spreadsheet") ||
      file.type.includes("excel")
    ) {
      uploaded.push({ type: "sheet", name: file.name, path, size: buf.byteLength, added_at: nowIso });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const lines: string[] = [`=== Arquivo: ${file.name} ===`];
      wb.eachSheet((sheet) => {
        lines.push(`-- Aba: ${sheet.name} --`);
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = cell.value;
            cells.push(
              v === null || v === undefined
                ? ""
                : String(
                    typeof v === "object" && "text" in (v as object)
                      ? (v as { text: unknown }).text
                      : v,
                  ),
            );
          });
          lines.push(cells.join(" | "));
        });
      });
      sheetTexts.push(lines.join("\n"));
    } else if (file.type.startsWith("image/")) {
      uploaded.push({ type: "image", name: file.name, path, size: buf.byteLength, added_at: nowIso });
      content.push({
        type: "image",
        source: { type: "base64", media_type: file.type, data: buf.toString("base64") },
      });
    } else {
      uploaded.push({ type: "other", name: file.name, path, size: buf.byteLength, added_at: nowIso });
    }
  }

  if (sheetTexts.length) {
    content.push({
      type: "text",
      text: `Conteúdo das planilhas extraído (cada linha = uma linha da planilha, colunas separadas por " | "):\n\n${sheetTexts.join("\n\n")}`,
    });
  }
  content.push({
    type: "text",
    text: "Extraia os campos conforme instruído e retorne APENAS o objeto JSON.",
  });

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let jsonText = "";
  // Tenta extrair empreendimento_id do prefix (formato: `emp/<uuid>` ou `draft/<slug>`).
  // Pra correlacionar custo de extração com o empreendimento no dashboard.
  const empId = prefix.startsWith("emp/") ? prefix.slice(4).split("/")[0] : null;
  const t0 = Date.now();
  try {
    const resp = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      // Sobe pra 8192 porque agora devolvemos structured + raw_chunks; um
      // memorial descritivo denso pode render 20-40 chunks de ~300 palavras
      // cada. Claude Sonnet 4 suporta até 8192 por default.
      max_tokens: 8192,
      system: EXTRACT_SYSTEM,
      // @ts-expect-error — document block suportado pela API mesmo se a tipagem do SDK ainda não trouxer
      messages: [{ role: "user", content }],
    });
    jsonText = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const u = anthropicUsage(resp);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "extract",
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      durationMs: Date.now() - t0,
      empreendimentoId: empId,
      metadata: { file_count: files.length, prefix },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[empreendimentos-extract] anthropic error:", msg);
    logUsage({
      provider: "anthropic",
      model: env.ANTHROPIC_MODEL,
      task: "extract",
      durationMs: Date.now() - t0,
      empreendimentoId: empId,
      ok: false,
      error: msg,
      metadata: { file_count: files.length, prefix },
    });
    return { ok: false, stage: "claude", error: msg, uploaded };
  }

  let extracted: ExtractedData = {};
  let rawChunks: RawKnowledge[] = [];
  try {
    const cleaned = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as {
      structured?: ExtractedData;
      raw_chunks?: Array<{ section?: string; text?: string; source_file?: string }>;
    };
    // Aceita dois shapes por compat: novo ({structured, raw_chunks}) ou antigo (plano).
    extracted = (parsed.structured ?? (parsed as unknown as ExtractedData)) ?? {};
    const nowIso = new Date().toISOString();
    rawChunks = (parsed.raw_chunks ?? [])
      .filter((c): c is { section: string; text: string; source_file?: string } =>
        Boolean(c && typeof c.section === "string" && typeof c.text === "string" && c.text.trim()),
      )
      .map((c) => ({
        section: c.section.trim(),
        text: c.text.trim(),
        source_file: c.source_file ?? "",
        added_at: nowIso,
      }));
  } catch (e) {
    console.error("[empreendimentos-extract] JSON parse failed:", e, jsonText.slice(0, 500));
    return {
      ok: false,
      stage: "parse",
      error: "Claude retornou JSON inválido",
      raw: jsonText.slice(0, 2000),
      uploaded,
    };
  }

  console.log("[empreendimentos-extract] done", {
    uploaded: uploaded.length,
    rawChunks: rawChunks.length,
    rawChunksChars: rawChunks.reduce((acc, c) => acc + c.text.length, 0),
  });

  return { ok: true, result: { uploaded, extracted, rawChunks } };
}
