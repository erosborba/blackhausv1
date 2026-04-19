import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { embedMany } from "@/lib/openai";

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
});

export async function GET() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("empreendimentos").select("*").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = empSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("empreendimentos").insert(parsed.data).select("*").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Indexa para RAG
  const chunks = chunkEmpreendimento(data);
  const embeddings = await embedMany(chunks.map((c) => c.content));
  if (chunks.length) {
    await sb.from("empreendimento_chunks").insert(
      chunks.map((c, i) => ({
        empreendimento_id: data.id,
        content: c.content,
        embedding: embeddings[i],
        metadata: c.metadata,
      })),
    );
  }
  return NextResponse.json({ ok: true, data, indexed: chunks.length });
}

function chunkEmpreendimento(e: any): { content: string; metadata: Record<string, unknown> }[] {
  const base = `Empreendimento ${e.nome} — ${e.bairro ?? ""}, ${e.cidade ?? ""} — ${e.status ?? ""}.`;
  const chunks: { content: string; metadata: Record<string, unknown> }[] = [];
  if (e.descricao) chunks.push({ content: `${base}\nDescrição: ${e.descricao}`, metadata: { kind: "descricao" } });
  if (Array.isArray(e.tipologias) && e.tipologias.length) {
    chunks.push({
      content: `${base}\nTipologias: ${e.tipologias
        .map((t: any) => `${t.quartos}q, ${t.area}m², ~R$${t.preco}`)
        .join("; ")}`,
      metadata: { kind: "tipologias" },
    });
  }
  if (Array.isArray(e.diferenciais) && e.diferenciais.length) {
    chunks.push({
      content: `${base}\nDiferenciais: ${e.diferenciais.join(", ")}`,
      metadata: { kind: "diferenciais" },
    });
  }
  if (Array.isArray(e.lazer) && e.lazer.length) {
    chunks.push({ content: `${base}\nLazer: ${e.lazer.join(", ")}`, metadata: { kind: "lazer" } });
  }
  return chunks;
}
