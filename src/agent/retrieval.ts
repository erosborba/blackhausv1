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
    : "sob consulta";

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

/** Remove acentos e normaliza pra comparação case-insensitive. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca filtrada por critérios estruturados.
 *
 * Cuidados:
 *  - Empreendimentos com `preco_inicial` NULL não são excluídos pelo filtro
 *    de preço máx (muitos ainda estão sem preço cadastrado — melhor mostrar
 *    com "sob consulta" do que esconder).
 *  - Match de bairro é feito em JS com normalização sem acento (Lindoia ≈ Lindóia),
 *    porque SQL `.in()` é exato. Fetchamos um pool maior e filtramos client-side.
 */
export async function searchByQualification(q: Qualification, limit = 5): Promise<string> {
  const sb = supabaseAdmin();
  let query = sb.from("empreendimentos").select("*").eq("ativo", true);

  if (q.cidade) query = query.ilike("cidade", `%${q.cidade}%`);
  if (q.faixa_preco_max) {
    // Aceita também empreendimentos sem preço — sinaliza "sob consulta" no render.
    query = query.or(`preco_inicial.lte.${q.faixa_preco_max},preco_inicial.is.null`);
  }

  // Busca um pool maior pra poder filtrar bairro/ordenar client-side.
  const { data, error } = await query.limit(Math.max(limit * 4, 20));
  if (error) throw error;
  let rows = (data ?? []) as Empreendimento[];

  if (q.bairros?.length) {
    const wants = q.bairros.map(norm);
    rows = rows.filter(
      (r) => r.bairro && wants.some((w) => norm(r.bairro!).includes(w) || w.includes(norm(r.bairro!))),
    );
  }

  rows = rows.slice(0, limit);
  if (!rows.length) return "";
  return rows.map(renderEmpreendimento).join("\n\n");
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
