import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { reindexEmpreendimento, type Midia } from "@/lib/empreendimentos";

/**
 * Redireciona pra signed URL do bucket `empreendimentos` pra download/preview.
 *
 * Por que redirect em vez de streamar? Signed URL é emitida pelo Supabase
 * direto, o navegador baixa/abre sem passar pelo nosso server. Mais rápido,
 * sem overhead de memória aqui.
 *
 * TTL de 5min (suficiente pra preview; link não vaza se compartilhado por
 * mais tempo).
 */

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; file: string[] }> };

/**
 * Valida que `storagePath` realmente pertence ao empreendimento `id` —
 * consultando o array `midias`. Funciona pra qualquer prefixo (emp/, draft/,
 * etc.) e impede enumeração cruzada mesmo se o atacante souber o UUID.
 *
 * Retorna `{ ok: true, midias }` ou `{ ok: false, status, error }`.
 */
async function ensureBelongs(
  id: string,
  storagePath: string,
): Promise<
  | { ok: true; midias: Midia[] }
  | { ok: false; status: number; error: string }
> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .select("midias")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "empreendimento não encontrado" };
  const midias: Midia[] = Array.isArray(data.midias) ? (data.midias as Midia[]) : [];
  const belongs = midias.some((m) => m.path === storagePath);
  if (!belongs) return { ok: false, status: 404, error: "arquivo não pertence a este empreendimento" };
  return { ok: true, midias };
}

export async function GET(_req: Request, { params }: Params) {
  const { id, file } = await params;
  // O client passa `encodeURIComponent(m.path)` num único segmento, mas
  // o Next já decoda nas partes. Junta tudo de volta.
  const storagePath = file.map(decodeURIComponent).join("/");

  const check = await ensureBelongs(id, storagePath);
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb.storage
    .from("empreendimentos")
    .createSignedUrl(storagePath, 300);

  if (error || !data?.signedUrl) {
    console.error("[docs] signed url error", error?.message);
    return NextResponse.json({ ok: false, error: "arquivo não encontrado" }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl, { status: 302 });
}

/**
 * DELETE /api/admin/empreendimentos/[id]/docs/[...file]
 *
 * Remove o arquivo do bucket + tira do array `midias` do empreendimento.
 * Não mexe em `raw_knowledge` — os chunks extraídos daquele doc seguem
 * úteis pra Bia mesmo sem o arquivo físico (ela responde pelo conteúdo).
 * Se o corretor quiser zerar o RAG também, edita o empreendimento.
 *
 * Reindex best-effort no fim (contagem de chunks por kind não muda, mas
 * mantemos por consistência se no futuro raw ficar atrelado ao arquivo).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, file } = await params;
  const storagePath = file.map(decodeURIComponent).join("/");

  const check = await ensureBelongs(id, storagePath);
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
  }

  const sb = supabaseAdmin();
  const newMidias = check.midias.filter((m) => m.path !== storagePath);

  // Apaga do storage. Best-effort: se o arquivo já não existir, seguimos
  // limpando o registro assim mesmo (estado era inconsistente).
  const { error: rmErr } = await sb.storage.from("empreendimentos").remove([storagePath]);
  if (rmErr) console.error("[docs DELETE] storage remove failed:", rmErr.message);

  // Atualiza o array `midias`. Mesmo se o path não estava lá, o update
  // é inofensivo.
  const { data: updated, error: updErr } = await sb
    .from("empreendimentos")
    .update({ midias: newMidias })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  // Reindex awaited — consistência do RAG com o estado pós-delete.
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[docs DELETE] reindex threw:", e);
  }

  return NextResponse.json({ ok: true, data: updated, indexed });
}
