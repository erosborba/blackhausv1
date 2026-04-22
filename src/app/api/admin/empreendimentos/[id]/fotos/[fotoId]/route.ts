import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Foto } from "@/lib/empreendimentos-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; fotoId: string }> };

const BUCKET = "empreendimentos";

/**
 * DELETE /api/admin/empreendimentos/[id]/fotos/[fotoId]
 *
 * Remove a foto do bucket + tira do array `fotos`. Best-effort no storage:
 * se o blob já não existir, seguimos limpando o registro assim mesmo.
 */
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id, fotoId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: emp, error: loadErr } = await sb
    .from("empreendimentos")
    .select("fotos")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
  if (!emp) return NextResponse.json({ ok: false, error: "não encontrado" }, { status: 404 });

  const fotos: Foto[] = Array.isArray(emp.fotos) ? (emp.fotos as Foto[]) : [];
  const target = fotos.find((f) => f.id === fotoId);
  if (!target) return NextResponse.json({ ok: false, error: "foto não encontrada" }, { status: 404 });

  await sb.storage.from(BUCKET).remove([target.path]).catch(() => null);

  const newFotos = fotos.filter((f) => f.id !== fotoId);
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update({ fotos: newFotos })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: updated });
}
