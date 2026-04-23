import { supabaseAdmin } from "@/lib/supabase";
import {
  getTabelaPrecosHeader,
  listarTipologias as listarTipologiasLib,
  type TipologiaResumo,
} from "@/lib/tabela-precos";

/**
 * Agent tool: listar tipologias com agregados de preço e área.
 *
 * Caso uso: "o que tem pra vender?", "quais as opções?" — a Bia responde
 * com resumo por tipologia antes de detalhar.
 */

export type ListarTipologiasInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
};

export type ListarTipologiasOutput =
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      tabela_disponivel: true;
      tipologias: TipologiaResumo[];
      entrega_prevista: string | null;
    }
  | {
      ok: false;
      reason: "empreendimento_not_found" | "tabela_nao_cadastrada";
      empreendimento_id?: string;
      empreendimento_nome?: string;
    };

export async function listarTipologias(
  input: ListarTipologiasInput,
): Promise<ListarTipologiasOutput> {
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

  const tipologias = await listarTipologiasLib(emp.id);
  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    tabela_disponivel: true,
    tipologias,
    entrega_prevista: header.entrega_prevista,
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
    console.error("[agent] listarTipologias.resolve:", error.message);
    return null;
  }
  return (data as { id: string; nome: string } | null) ?? null;
}
