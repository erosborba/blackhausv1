import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdminApi, requireSessionApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const BUCKET = "empreendimentos";

/**
 * Booking digital do empreendimento — PDF único, enviado pelo corretor,
 * servido pra futura tool `enviar_booking` da Bia. NÃO entra no RAG.
 *
 * POST   multipart (campo `file`, PDF) — substitui o existente.
 * GET    redirect pra signed URL (preview/admin download).
 * DELETE remove storage + zera coluna.
 */

async function loadEmp(id: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .select("id, booking_digital_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 404, error: "não encontrado" };
  return { ok: true as const, emp: data as { id: string; booking_digital_path: string | null } };
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const loaded = await loadEmp(id);
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "multipart inválido" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "arquivo ausente" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ ok: false, error: "apenas PDF" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const path = `emp/${id}/booking/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  // Substitui: apaga o antigo best-effort depois de salvar o novo.
  const old = loaded.emp.booking_digital_path;
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update({ booking_digital_path: path })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) {
    // rollback do upload
    await sb.storage.from(BUCKET).remove([path]).catch(() => null);
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }
  if (old && old !== path) {
    await sb.storage.from(BUCKET).remove([old]).catch(() => null);
  }

  return NextResponse.json({ ok: true, data: updated });
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const gate = await requireSessionApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const loaded = await loadEmp(id);
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
  if (!loaded.emp.booking_digital_path) {
    return NextResponse.json({ ok: false, error: "sem booking" }, { status: 404 });
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(loaded.emp.booking_digital_path, 300);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ ok: false, error: "falha ao gerar URL" }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const loaded = await loadEmp(id);
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });

  const sb = supabaseAdmin();
  const old = loaded.emp.booking_digital_path;
  if (old) {
    await sb.storage.from(BUCKET).remove([old]).catch(() => null);
  }
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update({ booking_digital_path: null })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: updated });
}
