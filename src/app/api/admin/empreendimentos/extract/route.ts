import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTRACT_SYSTEM = `Você é um assistente que extrai dados estruturados de documentos imobiliários (descritivos PDF, tabelas XLSX de valores, fotos de empreendimentos novos) para cadastro em CRM.

Retorne APENAS um objeto JSON puro (sem markdown, sem fences) com os campos abaixo. Se um campo não estiver nos documentos, use null para string/number ou array vazio. NÃO INVENTE.

{
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
}

Regras:
- preco_inicial: menor preço em BRL encontrado (só o número).
- entrega: formato YYYY-MM-DD; se só tiver mês/ano, use dia 01.
- estado: sigla UF (ex: PR, SC, SP).
- descricao: resumo curto (3-5 frases) juntando localização, público-alvo e destaques.
- tipologias: uma entrada por variação de planta. "area" em m². Se valores variam, use o mínimo.
- diferenciais/lazer: itens curtos (1-3 palavras), sem pontuação final.`;

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

type UploadedFile = {
  type: "pdf" | "sheet" | "image" | "other";
  name: string;
  path: string;
  size: number;
};

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "invalid multipart form" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "no files provided" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const draftId = randomUUID();
  const uploaded: UploadedFile[] = [];
  const content: ContentBlock[] = [];
  const sheetTexts: string[] = [];

  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `draft/${draftId}/${safeName}`;

    const { error: upErr } = await sb.storage
      .from("empreendimentos")
      .upload(path, buf, {
        contentType: file.type || undefined,
        upsert: true,
      });
    if (upErr) {
      return NextResponse.json(
        { ok: false, error: `upload falhou (${file.name}): ${upErr.message}` },
        { status: 500 },
      );
    }

    if (file.type === "application/pdf" || ext === "pdf") {
      uploaded.push({ type: "pdf", name: file.name, path, size: buf.byteLength });
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
        title: file.name,
      });
    } else if (ext === "xlsx" || ext === "xls" || file.type.includes("spreadsheet") || file.type.includes("excel")) {
      uploaded.push({ type: "sheet", name: file.name, path, size: buf.byteLength });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const lines: string[] = [`=== Arquivo: ${file.name} ===`];
      wb.eachSheet((sheet) => {
        lines.push(`-- Aba: ${sheet.name} --`);
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = cell.value;
            cells.push(v === null || v === undefined ? "" : String(typeof v === "object" && "text" in (v as object) ? (v as { text: unknown }).text : v));
          });
          lines.push(cells.join(" | "));
        });
      });
      sheetTexts.push(lines.join("\n"));
    } else if (file.type.startsWith("image/")) {
      uploaded.push({ type: "image", name: file.name, path, size: buf.byteLength });
      content.push({
        type: "image",
        source: { type: "base64", media_type: file.type, data: buf.toString("base64") },
      });
    } else {
      uploaded.push({ type: "other", name: file.name, path, size: buf.byteLength });
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
  try {
    const resp = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: EXTRACT_SYSTEM,
      // @ts-expect-error — document block é suportado pela API mesmo se a tipagem do SDK ainda não trouxer
      messages: [{ role: "user", content }],
    });
    jsonText = resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract] anthropic error:", msg);
    return NextResponse.json(
      { ok: false, error: `Claude extraction failed: ${msg}`, files: uploaded, draftId },
      { status: 502 },
    );
  }

  let extracted: Record<string, unknown> = {};
  try {
    const cleaned = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    extracted = JSON.parse(match ? match[0] : cleaned);
  } catch (e) {
    console.error("[extract] JSON parse failed:", e, jsonText.slice(0, 500));
    return NextResponse.json(
      { ok: false, error: "Claude retornou JSON inválido", raw: jsonText.slice(0, 2000), files: uploaded, draftId },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    draftId,
    files: uploaded,
    extracted,
  });
}
