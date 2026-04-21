import { supabaseAdmin } from "@/lib/supabase";
import { embed } from "@/lib/openai";
import type { Qualification } from "@/lib/leads";

type Empreendimento = {
  id: string;
  slug: string | null;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  status: string | null;
  preco_inicial: number | null;
  tipologias: Array<{ quartos?: number; area?: number; preco?: number }>;
  diferenciais: string[];
  descricao: string | null;
};

/**
 * Source que a mensagem outbound carrega em `messages.sources`.
 * UI do inbox mostra como pill "📎 Nome (bairro)" abaixo do bubble.
 *
 *   kind="semantic" → veio do pgvector (score = cosine similarity).
 *   kind="filter"   → veio de searchByQualification (score = null).
 */
export type RetrievedSource = {
  kind: "semantic" | "filter";
  empreendimentoId: string;
  slug: string | null;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  score: number | null;
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
export type FilterResult = {
  text: string;
  items: RetrievedSource[];
};

export async function searchByQualification(q: Qualification, limit = 5): Promise<FilterResult> {
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
  if (!rows.length) return { text: "", items: [] };

  const items: RetrievedSource[] = rows.map((r) => ({
    kind: "filter",
    empreendimentoId: r.id,
    slug: r.slug,
    nome: r.nome,
    bairro: r.bairro,
    cidade: r.cidade,
    score: null,
  }));

  return { text: rows.map(renderEmpreendimento).join("\n\n"), items };
}

export type SemanticResult = {
  /** Texto formatado pra injetar no system prompt. */
  text: string;
  /** Maior similaridade (cosine 0..1) entre a query e os chunks. null se fallback/vazio. */
  topScore: number | null;
  /** Empreendimentos citados (dedupe por id) — grava em messages.sources. */
  items: RetrievedSource[];
};

/**
 * Busca semântica via pgvector — usado quando o lead faz pergunta livre.
 *
 * Retorna também `topScore` (maior similaridade encontrada) pra que o
 * retrieveNode possa decidir se o contexto é forte o bastante pra a Bia
 * responder com confiança, ou se deve punt pro consultor humano.
 *
 * Os chunks vêm agrupados por empreendimento → `items` guarda um source
 * por empreendimento (maior similaridade entre os chunks dele).
 */
export async function searchSemantic(question: string, limit = 5): Promise<SemanticResult> {
  const sb = supabaseAdmin();
  try {
    const queryEmbedding = await embed(question);
    const { data, error } = await sb.rpc("match_empreendimento_chunks", {
      query_embedding: queryEmbedding,
      match_count: limit,
      filter: {},
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      empreendimento_id: string;
      content: string;
      similarity?: number;
    }>;
    if (!rows.length) return { text: "", topScore: null, items: [] };
    const topScore = rows.reduce(
      (m, r) => (typeof r.similarity === "number" && r.similarity > m ? r.similarity : m),
      0,
    );
    const text = rows.map((c) => `• ${c.content}`).join("\n");

    // Dedupe por empreendimento_id, guardando o maior similarity de cada
    const bestByEmp = new Map<string, number>();
    for (const r of rows) {
      const sc = typeof r.similarity === "number" ? r.similarity : 0;
      const cur = bestByEmp.get(r.empreendimento_id);
      if (cur === undefined || sc > cur) bestByEmp.set(r.empreendimento_id, sc);
    }
    const ids = [...bestByEmp.keys()];
    let items: RetrievedSource[] = [];
    if (ids.length) {
      const { data: emps } = await sb
        .from("empreendimentos")
        .select("id, slug, nome, bairro, cidade")
        .in("id", ids);
      items = (emps ?? []).map((e) => ({
        kind: "semantic" as const,
        empreendimentoId: e.id as string,
        slug: (e as { slug: string | null }).slug,
        nome: (e as { nome: string }).nome,
        bairro: (e as { bairro: string | null }).bairro,
        cidade: (e as { cidade: string | null }).cidade,
        score: bestByEmp.get(e.id as string) ?? null,
      }));
      items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    return { text, topScore: topScore || null, items };
  } catch {
    // RAG opcional — sem chunks ainda, cai no catálogo bruto (sem score).
    const { data } = await sb.from("empreendimentos").select("*").eq("ativo", true).limit(limit);
    if (!data?.length) return { text: "", topScore: null, items: [] };
    const rows = data as Empreendimento[];
    const items: RetrievedSource[] = rows.map((r) => ({
      kind: "filter",
      empreendimentoId: r.id,
      slug: r.slug,
      nome: r.nome,
      bairro: r.bairro,
      cidade: r.cidade,
      score: null,
    }));
    return {
      text: rows.map(renderEmpreendimento).join("\n\n"),
      topScore: null,
      items,
    };
  }
}
