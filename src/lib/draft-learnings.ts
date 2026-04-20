import { supabaseAdmin } from "./supabase";

/**
 * Feedback loop — few-shot de correções recentes dos corretores.
 *
 * Toda vez que um corretor edita um draft que a Bia propôs (action='edited'
 * com final_text != proposed_text), isso é um sinal forte de que a Bia
 * errou tom, conteúdo ou postura. Injetar alguns desses pares como
 * exemplos no system prompt ensina a Bia a copiar o estilo humano sem
 * precisar retrainar nada.
 *
 * Priorizamos edições de drafts com confidence='alta' — quando a Bia
 * estava MUITO segura mas o humano ainda corrigiu, o gap é mais útil de
 * aprender do que correções em drafts "baixa" (onde já se esperava mexer).
 *
 * Limites:
 *  - Só os 4 mais recentes (prompt não pode explodir).
 *  - Só edições reais (ignora ed em que final_text == proposed_text).
 *  - Truncamos textos longos pra caber no contexto.
 */

const MAX_EDITS = 4;
const MAX_CHARS_PER_SIDE = 400;

function clip(s: string, n = MAX_CHARS_PER_SIDE): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export async function getRecentDraftEdits(): Promise<string> {
  const sb = supabaseAdmin();
  // Preferência: confidence='alta' primeiro, depois completa com media/baixa
  // se faltarem exemplos. Uma única query ordenada por (alta > media > baixa)
  // via CASE seria ideal, mas mantemos duas queries simples.
  const baseFilter = sb
    .from("drafts")
    .select("proposed_text, final_text, confidence, created_at")
    .eq("action", "edited")
    .not("final_text", "is", null)
    .order("created_at", { ascending: false });

  const { data: alta } = await baseFilter.eq("confidence", "alta").limit(MAX_EDITS);
  let pool = (alta ?? []).filter((r) => r.final_text && r.final_text.trim() !== r.proposed_text.trim());

  if (pool.length < MAX_EDITS) {
    const remaining = MAX_EDITS - pool.length;
    const { data: outros } = await sb
      .from("drafts")
      .select("proposed_text, final_text, confidence, created_at")
      .eq("action", "edited")
      .in("confidence", ["media", "baixa"])
      .not("final_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(remaining);
    const extras = (outros ?? []).filter(
      (r) => r.final_text && r.final_text.trim() !== r.proposed_text.trim(),
    );
    pool = [...pool, ...extras];
  }

  if (pool.length === 0) return "";

  const blocks = pool.slice(0, MAX_EDITS).map((r, i) => {
    const proposto = clip(r.proposed_text);
    const final = clip(r.final_text as string);
    return `Exemplo ${i + 1} (confidence: ${r.confidence}):
— Você havia proposto:
"${proposto}"
— O corretor enviou (correto):
"${final}"`;
  });

  return `CORREÇÕES RECENTES DOS CORRETORES (aprenda com o estilo/tom/conteúdo preferido — NÃO copie literal, internalize o padrão):

${blocks.join("\n\n")}`;
}
