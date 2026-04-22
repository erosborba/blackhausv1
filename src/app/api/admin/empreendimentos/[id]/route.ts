import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { reindexEmpreendimento } from "@/lib/empreendimentos";
import { requireAdminApi, requireSessionApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tipologia = z.object({
  quartos: z.number().int().nullish(),
  suites: z.number().int().nullish(),
  vagas: z.number().int().nullish(),
  area: z.number().nullish(),
  preco: z.number().nullish(),
});

// Todos os campos são opcionais no PATCH — o cliente manda só o que mudou.
const patchSchema = z.object({
  nome: z.string().min(1).optional(),
  construtora: z.string().nullish(),
  status: z.enum(["lancamento", "em_obras", "pronto_para_morar"]).nullish(),
  endereco: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  estado: z.string().nullish(),
  preco_inicial: z.number().nullish(),
  tipologias: z.array(tipologia).optional(),
  diferenciais: z.array(z.string()).optional(),
  lazer: z.array(z.string()).optional(),
  entrega: z.string().nullish(),
  descricao: z.string().nullish(),
  ativo: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const gate = await requireSessionApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("empreendimentos").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[empreendimentos PATCH] update error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Reindex — se o update afetou descrição/tipologias/etc, chunks ficam
  // stale. Best-effort; não bloqueia sucesso do PATCH.
  let indexed = 0;
  try {
    indexed = await reindexEmpreendimento(id);
  } catch (e) {
    console.error("[empreendimentos PATCH] reindex failed:", e);
  }

  return NextResponse.json({ ok: true, data, indexed });
}

/**
 * DELETE /api/admin/empreendimentos/[id]
 *
 * Hard delete: remove row (FKs em cascade limpam `empreendimento_chunks` e
 * `empreendimento_faqs`) + varre o storage em `emp/{id}/` pra não deixar
 * arquivo órfão. Leads que referenciam o empreendimento continuam válidos
 * (coluna `empreendimento_id` em leads é nullable/sem FK dura).
 *
 * Falha de storage não bloqueia a exclusão do registro — o DB é a fonte
 * de verdade e já foi limpo.
 */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const sb = supabaseAdmin();

  // 1) Apaga arquivos do bucket (best-effort). Fazemos ANTES do delete do
  //    registro porque, se o DB falhar, pelo menos tentamos novamente via
  //    retry; se o storage falhar, o listing de órfãos depois é fácil.
  try {
    const { data: files } = await sb.storage.from("empreendimentos").list(`emp/${id}`, {
      limit: 1000,
    });
    if (files && files.length) {
      const paths = files.map((f) => `emp/${id}/${f.name}`);
      const { error: rmErr } = await sb.storage.from("empreendimentos").remove(paths);
      if (rmErr) console.error("[empreendimentos DELETE] storage remove failed:", rmErr.message);
    }
  } catch (e) {
    console.error("[empreendimentos DELETE] storage cleanup threw:", e);
  }

  // 2) Remove o registro. Cascade cuida de chunks + FAQs.
  const { error } = await sb.from("empreendimentos").delete().eq("id", id);
  if (error) {
    console.error("[empreendimentos DELETE] delete error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
