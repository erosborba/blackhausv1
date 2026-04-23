import { supabaseAdmin } from "@/lib/supabase";
import {
  consultarUnidadePorNumero,
  getTabelaPrecosHeader,
  type UnidadeLookup,
} from "@/lib/tabela-precos";

/**
 * Agent tool: consulta de uma unidade específica por número.
 *
 * Caso uso principal: lead manda "qual o valor da 1811?" — a Bia precisa
 * responder COM precisão (valor exato, plano de pagamento completo),
 * SEM confundir com unidade de número parecido (1812) e SEM inventar
 * quando não existe.
 *
 * Retorna dado estruturado (o prompt da Bia formata). Distingue três casos:
 *   - unidade existe e está disponível → payload completo
 *   - unidade existe mas indisponível (vendida/reservada) → payload + motivo
 *   - unidade não existe na tabela OU tabela não cadastrada → explícito
 */

export type ConsultarUnidadeInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
  numero: string;
};

export type ConsultarUnidadeOutput =
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      tabela_disponivel: true;
      unidade_encontrada: true;
      disponivel: boolean;
      status: UnidadeLookup["status"];
      unidade: UnidadeLookup;
    }
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      tabela_disponivel: true;
      unidade_encontrada: false;
      unidade_nao_encontrada: true;
    }
  | {
      ok: false;
      reason: "empreendimento_not_found" | "tabela_nao_cadastrada";
      empreendimento_id?: string;
      empreendimento_nome?: string;
    };

export async function consultarUnidade(
  input: ConsultarUnidadeInput,
): Promise<ConsultarUnidadeOutput> {
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

  const unidade = await consultarUnidadePorNumero(emp.id, input.numero.trim());
  if (!unidade) {
    return {
      ok: true,
      empreendimento_id: emp.id,
      empreendimento_nome: emp.nome,
      tabela_disponivel: true,
      unidade_encontrada: false,
      unidade_nao_encontrada: true,
    };
  }

  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    tabela_disponivel: true,
    unidade_encontrada: true,
    disponivel: unidade.status === "avail",
    status: unidade.status,
    unidade,
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
    console.error("[agent] consultarUnidade.resolve:", error.message);
    return null;
  }
  return (data as { id: string; nome: string } | null) ?? null;
}
