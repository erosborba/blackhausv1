import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import type { Foto, FotoCategoria } from "@/lib/empreendimentos-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const BUCKET = "empreendimentos";
const VALID_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VALID_CATEGORIAS: FotoCategoria[] = [
  "fachada",
  "lazer",
  "decorado",
  "planta",
  "vista",
  "outros",
];

function asCategoria(v: unknown): FotoCategoria {
  return typeof v === "string" && (VALID_CATEGORIAS as string[]).includes(v)
    ? (v as FotoCategoria)
    : "outros";
}

async function loadEmp(id: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .select("id, fotos")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 404, error: "não encontrado" };
  const fotos: Foto[] = Array.isArray(data.fotos) ? (data.fotos as Foto[]) : [];
  return { ok: true as const, fotos };
}

/**
 * POST /api/admin/empreendimentos/[id]/fotos?categoria=lazer
 *
 * Recebe múltiplas imagens via multipart (campo `files`), sobe em
 * `emp/{id}/fotos/` e anexa ao array `fotos` do empreendimento.
 * NÃO aciona extração/RAG — fotos são só mídia de envio.
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const loaded = await loadEmp(id);
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });

  const url = new URL(req.url);
  const categoria = asCategoria(url.searchParams.get("categoria"));

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "multipart inválido" }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ ok: false, error: "sem arquivos" }, { status: 400 });

  for (const f of files) {
    if (!VALID_MIMES.has(f.type)) {
      return NextResponse.json(
        { ok: false, error: `tipo inválido: ${f.type || f.name}. Use JPG, PNG ou WebP.` },
        { status: 400 },
      );
    }
  }

  const sb = supabaseAdmin();
  const uploaded: Foto[] = [];
  const uploadedPaths: string[] = [];
  const nowIso = new Date().toISOString();
  const baseOrdem = loaded.fotos.length;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const safeName = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `emp/${id}/fotos/${Date.now()}-${i}-${safeName}`;
    const bytes = Buffer.from(await f.arrayBuffer());
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: f.type,
      upsert: false,
    });
    if (upErr) {
      // rollback dos que já subiram
      if (uploadedPaths.length) {
        await sb.storage.from(BUCKET).remove(uploadedPaths).catch(() => null);
      }
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }
    uploadedPaths.push(path);
    uploaded.push({
      id: randomUUID(),
      path,
      name: f.name,
      size: f.size,
      categoria,
      legenda: null,
      ordem: baseOrdem + i,
      added_at: nowIso,
    });
  }

  const newFotos = [...loaded.fotos, ...uploaded];
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update({ fotos: newFotos })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) {
    await sb.storage.from(BUCKET).remove(uploadedPaths).catch(() => null);
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: updated, added: uploaded.length });
}

/**
 * PATCH /api/admin/empreendimentos/[id]/fotos
 * body: { id, legenda?, categoria?, ordem? }
 *
 * Edita metadados de uma foto específica in-place (sem re-upload).
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const loaded = await loadEmp(id);
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });

  const body = (await req.json().catch(() => null)) as
    | { id?: string; legenda?: string | null; categoria?: string; ordem?: number }
    | null;
  if (!body?.id) return NextResponse.json({ ok: false, error: "foto id ausente" }, { status: 400 });

  const idx = loaded.fotos.findIndex((f) => f.id === body.id);
  if (idx < 0) return NextResponse.json({ ok: false, error: "foto não encontrada" }, { status: 404 });

  const cur = loaded.fotos[idx];
  const next: Foto = {
    ...cur,
    legenda:
      body.legenda === undefined
        ? cur.legenda
        : body.legenda === null
          ? null
          : String(body.legenda).slice(0, 300),
    categoria: body.categoria !== undefined ? asCategoria(body.categoria) : cur.categoria,
    ordem: typeof body.ordem === "number" ? body.ordem : cur.ordem,
  };
  const newFotos = [...loaded.fotos];
  newFotos[idx] = next;

  const sb = supabaseAdmin();
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update({ fotos: newFotos })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: updated });
}
