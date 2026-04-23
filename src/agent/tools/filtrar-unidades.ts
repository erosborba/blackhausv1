import { supabaseAdmin } from "@/lib/supabase";
import {
  filtrarUnidades as filtrarUnidadesLib,
  getTabelaPrecosHeader,
  type UnidadeFiltrada,
} from "@/lib/tabela-precos";

/**
 * Agent tool: filtrar unidades por critérios (tipologia, preço, área, andar).
 *
 * Caso uso: "tem studio até 400 mil?", "me mostra 2 quartos", "tem loja?".
 * A Bia chama, recebe lista (ordenada por preço asc), e formata no estilo
 * WhatsApp. Retorno inclui também faixas agregadas pra Bia falar de range.
 */

export type FiltrarUnidadesInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
  tipologia?: string | null;
  preco_min?: number | null;
  preco_max?: number | null;
  area_min?: number | null;
  andar_min?: number | null;
  andar_max?: number | null;
  apenas_disponiveis?: boolean;
  /** Null = residencial + comercial; true = só lojas; false = só residencial. */
  is_comercial?: boolean | null;
  limit?: number;
};

export type FiltrarUnidadesOutput =
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      tabela_disponivel: true;
      count: number;
      unidades: UnidadeFiltrada[];
      faixas: {
        preco_min: number | null;
        preco_max: number | null;
        area_min: number | null;
        area_max: number | null;
      };
    }
  | {
      ok: false;
      reason: "empreendimento_not_found" | "tabela_nao_cadastrada";
      empreendimento_id?: string;
      empreendimento_nome?: string;
    };

export async function filtrarUnidades(
  input: FiltrarUnidadesInput,
): Promise<FiltrarUnidadesOutput> {
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

  const unidades = await filtrarUnidadesLib({
    empreendimentoId: emp.id,
    tipologia: input.tipologia ?? null,
    preco_min: input.preco_min ?? null,
    preco_max: input.preco_max ?? null,
    area_min: input.area_min ?? null,
    andar_min: input.andar_min ?? null,
    andar_max: input.andar_max ?? null,
    apenas_disponiveis: input.apenas_disponiveis ?? true,
    is_comercial: input.is_comercial ?? null,
    limit: input.limit ?? 20,
  });

  const faixas = unidades.reduce<{
    preco_min: number | null;
    preco_max: number | null;
    area_min: number | null;
    area_max: number | null;
  }>(
    (acc, u) => {
      if (u.preco_total != null) {
        acc.preco_min = acc.preco_min == null ? u.preco_total : Math.min(acc.preco_min, u.preco_total);
        acc.preco_max = acc.preco_max == null ? u.preco_total : Math.max(acc.preco_max, u.preco_total);
      }
      if (u.area_privativa != null) {
        acc.area_min = acc.area_min == null ? u.area_privativa : Math.min(acc.area_min, u.area_privativa);
        acc.area_max = acc.area_max == null ? u.area_privativa : Math.max(acc.area_max, u.area_privativa);
      }
      return acc;
    },
    { preco_min: null, preco_max: null, area_min: null, area_max: null },
  );

  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    tabela_disponivel: true,
    count: unidades.length,
    unidades,
    faixas,
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
    console.error("[agent] filtrarUnidades.resolve:", error.message);
    return null;
  }
  return (data as { id: string; nome: string } | null) ?? null;
}
