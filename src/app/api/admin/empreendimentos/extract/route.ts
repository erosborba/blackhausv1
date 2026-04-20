import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { extractFromFiles } from "@/lib/empreendimentos-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wizard de criação: recebe arquivos, manda pro Claude extrair, devolve
 * o JSON estruturado pro corretor revisar antes de salvar via POST.
 *
 * Arquivos vão pra `draft/{id}/` — depois, no POST de criação, os paths
 * são copiados pro campo `midias` do empreendimento. (Não movemos os
 * arquivos; ficam no draft/ mesmo — não vale a complicação pra MVP.)
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "invalid multipart form" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "no files provided" }, { status: 400 });
  }

  const draftId = randomUUID();
  const out = await extractFromFiles(files, `draft/${draftId}`);
  if (!out.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: out.stage,
        error: out.error,
        raw: "raw" in out ? out.raw : undefined,
        files: out.uploaded,
        draftId,
      },
      { status: out.stage === "upload" ? 500 : 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    draftId,
    files: out.result.uploaded,
    extracted: out.result.extracted,
    rawChunks: out.result.rawChunks,
  });
}
