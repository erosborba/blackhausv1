import { supabaseAdmin } from "@/lib/supabase";
import { embed } from "@/lib/openai";
import type { Qualification } from "@/lib/leads";

type Empreendimento = {
  id: string;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  status: string | null;
  preco_inicial: number | null;
  tipologias: Array<{ quartos?: number; area?: number; preco?: number }>;
  diferenciais: string[];
  descricao: string | null;
};

const fmtBRL = (n?: number | null) =>
  typeof n === "number"
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : "—";

function renderEmpreendimento(e: Empreendimento): string {
  const tipologias =
    e.tipologias?.length > 0
      ? e.tipologias
          .map((t) => `${t.quartos ?? "?"}q · ${t.area ?? "?"}m² · ${fmtBRL(t.preco)}`)
          .join(" | ")
      : "—";
  const dif = e.diferenciais?.length ? e.diferenciais.slice(0, 4).join(", ") : "—";
  return [
    `• ${e.nome} (${e.bairro ?? "—"}, ${e.cidade ?? "—"}) — ${e.status ?? "—"}`,
    `  preço a partir de ${fmtBRL(e.preco_inicial)}`,
    `  tipologias: ${tipologias}`,
    `  diferenciais: ${dif}`,
    e.descricao ? `  resumo: ${e.descricao.slice(0, 280)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Busca filtrada por critérios estruturados (sem embedding). */
export async function searchByQualification(q: Qualification, limit = 5): Promise<string> {
  const sb = supabaseAdmin();
  let query = sb.from("empreendimentos").select("*").eq("ativo", true).limit(limit);

  if (q.cidade) query = query.ilike("cidade", `%${q.cidade}%`);
  if (q.bairros?.length) query = query.in("bairro", q.bairros);
  if (q.faixa_preco_max) query = query.lte("preco_inicial", q.faixa_preco_max);

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return "";
  return (data as Empreendimento[]).map(renderEmpreendimento).join("\n\n");
}

/** Busca semântica via pgvector — usado quando o lead faz pergunta livre. */
export async function searchSemantic(question: string, limit = 5): Promise<string> {
  try {
    const queryEmbedding = await embed(question);
    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("match_empreendimento_chunks", {
      query_embedding: queryEmbedding,
      match_count: limit,
      filter: {},
    });
    if (error) throw error;
    if (!data?.length) return "";
    return (data as Array<{ content: string }>).map((c) => `• ${c.content}`).join("\n");
  } catch {
    // RAG opcional — sem chunks ainda, cai no catálogo bruto
    const sb = supabaseAdmin();
    const { data } = await sb.from("empreendimentos").select("*").eq("ativo", true).limit(limit);
    if (!data?.length) return "";
    return (data as Empreendimento[]).map(renderEmpreendimento).join("\n\n");
  }
}
