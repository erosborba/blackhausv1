import { supabaseAdmin } from "@/lib/supabase";
import {
  filtrarUnidades,
  getTabelaPrecosHeader,
  listarTipologias,
} from "@/lib/tabela-precos";

/**
 * Agent tool: resumo executivo da tabela de preços.
 *
 * Caso uso: "me conta o que tem no AYA?", perguntas abertas. Retorna
 * contagens + range de preço geral + entrega + disclaimers curados
 * (pra Bia saber contar a história da obra sem inventar termos de
 * pagamento).
 */

export type ResumoTabelaPrecosInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
};

export type ResumoTabelaPrecosOutput =
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      tabela_disponivel: true;
      total_unidades: number;
      disponiveis: number;
      residenciais_disponiveis: number;
      comerciais_disponiveis: number;
      preco_range: { min: number | null; max: number | null };
      entrega_prevista: string | null;
      disclaimers: string[];
      tipologias_disponiveis: string[];
    }
  | {
      ok: false;
      reason: "empreendimento_not_found" | "tabela_nao_cadastrada";
      empreendimento_id?: string;
      empreendimento_nome?: string;
    };

export async function resumoTabelaPrecos(
  input: ResumoTabelaPrecosInput,
): Promise<ResumoTabelaPrecosOutput> {
  const emp = await resolveEmp(input);
  if (!emp) return { ok: false, reason: "empreendimento_not_found" };

  const header = await getTabelaPrecosHeader(emp.id);
  if (!header) {
    return {
      ok: false,
      reason: "tabela_nao_cadastrada",
      empreendimento_id: emp.id,
      empreendimento_nome: emp.nome,
    };
  }

  const tipologias = await listarTipologias(emp.id);

  // Rápido: pega apenas 200 unidades disponíveis pra calcular range.
  // Pro caso comum (≤130 linhas), é todo mundo.
  const todas = await filtrarUnidades({
    empreendimentoId: emp.id,
    apenas_disponiveis: false,
    limit: 100,
  });
  const avail = todas.filter((u) => u.status === "avail");
  const precos = avail
    .map((u) => u.preco_total)
    .filter((p): p is number => typeof p === "number" && p > 0);

  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    tabela_disponivel: true,
    total_unidades: header.parsed_rows_count,
    disponiveis: avail.length,
    residenciais_disponiveis: avail.filter((u) => !u.is_comercial).length,
    comerciais_disponiveis: avail.filter((u) => u.is_comercial).length,
    preco_range: {
      min: precos.length ? Math.min(...precos) : null,
      max: precos.length ? Math.max(...precos) : null,
    },
    entrega_prevista: header.entrega_prevista,
    disclaimers: header.disclaimers,
    tipologias_disponiveis: tipologias
      .filter((t) => t.disponivel > 0)
      .map((t) => t.tipologia),
  };
}

async function resolveEmp(
  input: { empreendimento_id?: string; empreendimento_slug?: string },
): Promise<{ id: string; nome: string } | null> {
  if (!input.empreendimento_id && !input.empreendimento_slug) return null;
  const sb = supabaseAdmin();
  let q = sb.from("empreendimentos").select("id, nome").eq("ativo", true).limit(1);
  if (input.empreendimento_id) q = q.eq("id", input.empreendimento_id);
  if (input.empreendimento_slug) q = q.eq("slug", input.empreendimento_slug);
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error("[agent] resumoTabelaPrecos.resolve:", error.message);
    return null;
  }
  return (data as { id: string; nome: string } | null) ?? null;
}
