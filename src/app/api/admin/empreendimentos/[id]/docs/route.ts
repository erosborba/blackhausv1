import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractFromFiles } from "@/lib/empreendimentos-extract";
import {
  mergeExtracted,
  mergeRawKnowledge,
  reindexEmpreendimento,
  type Empreendimento,
  type Midia,
  type RawKnowledge,
} from "@/lib/empreendimentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/empreendimentos/[id]/docs
 *
 * Recebe arquivos (multipart), sobe em `emp/{id}/`, extrai dados com a IA,
 * faz merge no empreendimento existente (sem sobrescrever edições manuais),
 * anexa em `midias` e reindexa o RAG.
 *
 * Retorna o empreendimento atualizado + diff de campos que mudaram, pra
 * UI mostrar ao corretor o que foi adicionado.
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  // Busca o empreendimento ANTES de subir arquivos — se nem existir, não
  // gastamos storage nem token de Claude.
  const sb = supabaseAdmin();
  const { data: current, error: loadErr } = await sb
    .from("empreendimentos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "invalid multipart form" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) {
    return NextResponse.json({ ok: false, error: "no files provided" }, { status: 400 });
  }

  const out = await extractFromFiles(files, `emp/${id}`);
  if (!out.ok) {
    return NextResponse.json(
      {
        ok: false,
        stage: out.stage,
        error: out.error,
        raw: "raw" in out ? out.raw : undefined,
        uploaded: out.uploaded,
      },
      { status: out.stage === "upload" ? 500 : 502 },
    );
  }

  const currentEmp = current as Empreendimento;
  const patch = mergeExtracted(currentEmp, out.result.extracted);
  const newMidias: Midia[] = [...(currentEmp.midias ?? []), ...out.result.uploaded];
  const newRaw: RawKnowledge[] = mergeRawKnowledge(
    currentEmp.raw_knowledge,
    out.result.rawChunks,
  );

  // Aplica patch de campos estruturados + append nas mídias + raw_knowledge.
  const updatePayload: Record<string, unknown> = {
    ...patch,
    midias: newMidias,
    raw_knowledge: newRaw,
  };
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) {
    console.error("[empreendimentos docs] update error:", updErr);
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  // Reindexa RAG com os dados novos.
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[empreendimentos docs] reindex failed:", e);
  }

  // Diff simplificado: chaves do patch que realmente caíram no update.
  const changed = Object.keys(patch);
  const rawAdded = out.result.rawChunks.length;

  return NextResponse.json({
    ok: true,
    data: updated,
    extracted: out.result.extracted,
    uploaded: out.result.uploaded,
    rawAdded,
    changed,
    indexed,
  });
}
