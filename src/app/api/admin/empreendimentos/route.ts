import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { reindexEmpreendimento } from "@/lib/empreendimentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// .nullish() = optional + nullable. Claude costuma devolver null em campos
// ausentes do descritivo (ex: preço da tipologia quando a tabela ainda não
// está pronta), e queremos aceitar.
const tipologia = z.object({
  quartos: z.number().int().nullish(),
  suites: z.number().int().nullish(),
  vagas: z.number().int().nullish(),
  area: z.number().nullish(),
  preco: z.number().nullish(),
});

const empSchema = z.object({
  nome: z.string().min(1),
  slug: z.string().nullish(),
  construtora: z.string().nullish(),
  status: z.enum(["lancamento", "em_obras", "pronto_para_morar"]).nullish(),
  endereco: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  estado: z.string().nullish(),
  preco_inicial: z.number().nullish(),
  tipologias: z.array(tipologia).default([]),
  diferenciais: z.array(z.string()).default([]),
  lazer: z.array(z.string()).default([]),
  entrega: z.string().nullish(),
  descricao: z.string().nullish(),
  midias: z.array(z.any()).default([]),
  raw_knowledge: z.array(z.any()).default([]),
});

export async function GET() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = empSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("empreendimentos")
      .insert(parsed.data)
      .select("*")
      .single();
    if (error) {
      console.error("[empreendimentos] insert error:", error);
      return NextResponse.json(
        { ok: false, stage: "insert", error: error.message, details: error },
        { status: 500 },
      );
    }

    // Indexa para RAG — falha aqui não invalida o cadastro.
    const indexed = await reindexEmpreendimento(data.id);
    return NextResponse.json({ ok: true, data, indexed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[empreendimentos] unhandled:", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
