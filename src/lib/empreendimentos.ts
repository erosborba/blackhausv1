import { supabaseAdmin } from "./supabase";
import { embedMany } from "./openai";
import { chunkEmpreendimento, type Empreendimento, type Faq } from "./empreendimentos-shared";

/**
 * Server-only. Re-exporta tudo de `empreendimentos-shared` (tipos + helpers
 * puros) e adiciona `reindexEmpreendimento`, que tem dependência de supabase
 * + openai (não pode ser bundled no client).
 *
 * Client Components devem importar direto de `@/lib/empreendimentos-shared`.
 */

export * from "./empreendimentos-shared";

/**
 * Apaga chunks antigos e recria. Usado depois de PATCH ou de merge de novos
 * docs — garante que RAG está consistente com o estado atual.
 *
 * Não joga erro: falha de reindex não deve bloquear a escrita (o registro
 * principal já foi salvo pelo caller).
 */
export async function reindexEmpreendimento(id: string): Promise<number> {
  const sb = supabaseAdmin();
  const [empRes, faqsRes] = await Promise.all([
    sb.from("empreendimentos").select("*").eq("id", id).maybeSingle(),
    sb
      .from("empreendimento_faqs")
      .select("*")
      .eq("empreendimento_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (empRes.error || !empRes.data) {
    console.error("[empreendimentos] reindex: load failed", empRes.error?.message);
    return 0;
  }
  const emp = empRes.data as Empreendimento;
  const faqs = (faqsRes.data ?? []) as Faq[];

  // Drop chunks antigos.
  const { error: delErr } = await sb
    .from("empreendimento_chunks")
    .delete()
    .eq("empreendimento_id", id);
  if (delErr) console.error("[empreendimentos] reindex: delete failed", delErr.message);

  const chunks = chunkEmpreendimento(emp, faqs);
  console.log("[empreendimentos] reindex", {
    id,
    total: chunks.length,
    byKind: chunks.reduce<Record<string, number>>((acc, c) => {
      const k = String(c.metadata.kind ?? "?");
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  });
  if (!chunks.length) return 0;

  try {
    const embeddings = await embedMany(chunks.map((c) => c.content));
    const { error: insErr } = await sb.from("empreendimento_chunks").insert(
      chunks.map((c, i) => ({
        empreendimento_id: id,
        content: c.content,
        embedding: embeddings[i],
        metadata: c.metadata,
      })),
    );
    if (insErr) {
      console.error("[empreendimentos] reindex: insert failed", insErr.message);
      return 0;
    }
    return chunks.length;
  } catch (e) {
    console.error("[empreendimentos] reindex: embed failed", e instanceof Error ? e.message : e);
    return 0;
  }
}
