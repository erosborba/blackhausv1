import { supabaseAdmin } from "@/lib/supabase";
import {
  filtrarUnidadesMulti as filtrarUnidadesMultiLib,
  type UnidadeMulti,
} from "@/lib/tabela-precos";

/**
 * Agent tool: filtra unidades em MÚLTIPLOS empreendimentos.
 *
 * Caso uso: lead pergunta "tem studio até 400 mil?" sem mencionar nome do
 * prédio. Em vez de a Bia responder "vou perguntar pro consultor", varremos
 * todos os empreendimentos ativos com tabela carregada e devolvemos as
 * melhores opções por preço.
 *
 * Retorno é flat (linhas com `empreendimento_nome`/`empreendimento_id` por
 * unidade) — quem renderiza decide se agrupa ou não.
 */

export type FiltrarUnidadesMultiInput = {
  /** Lista de IDs alvo. Null/omitido = todos os empreendimentos ativos. */
  empreendimento_ids?: string[] | null;
  tipologia?: string | null;
  preco_min?: number | null;
  preco_max?: number | null;
  area_min?: number | null;
  andar_min?: number | null;
  andar_max?: number | null;
  apenas_disponiveis?: boolean;
  is_comercial?: boolean | null;
  limit_per_emp?: number;
  limit_total?: number;
};

export type FiltrarUnidadesMultiOutput =
  | {
      ok: true;
      count: number;
      empreendimentos_com_match: number;
      unidades: UnidadeMulti[];
      faixas: {
        preco_min: number | null;
        preco_max: number | null;
        area_min: number | null;
        area_max: number | null;
      };
    }
  | { ok: false; reason: "no_active_empreendimentos" };

export async function filtrarUnidadesMulti(
  input: FiltrarUnidadesMultiInput,
): Promise<FiltrarUnidadesMultiOutput> {
  // Se o caller não passou IDs, resolvemos os ativos aqui pra poder reportar
  // "no_active_empreendimentos" cedo (em vez de devolver count=0 ambíguo).
  let ids = input.empreendimento_ids ?? null;
  if (!ids || ids.length === 0) {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("empreendimentos")
      .select("id")
      .eq("ativo", true);
    if (error) {
      console.error("[agent] filtrarUnidadesMulti.listAtivos:", error.message);
      return { ok: false, reason: "no_active_empreendimentos" };
    }
    ids = (data ?? []).map((r) => String((r as { id: string }).id));
    if (ids.length === 0) return { ok: false, reason: "no_active_empreendimentos" };
  }

  const unidades = await filtrarUnidadesMultiLib({
    empreendimentoIds: ids,
    tipologia: input.tipologia ?? null,
    preco_min: input.preco_min ?? null,
    preco_max: input.preco_max ?? null,
    area_min: input.area_min ?? null,
    andar_min: input.andar_min ?? null,
    andar_max: input.andar_max ?? null,
    apenas_disponiveis: input.apenas_disponiveis ?? true,
    is_comercial: input.is_comercial ?? null,
    limit_per_emp: input.limit_per_emp ?? 5,
    limit_total: input.limit_total ?? 30,
  });

  const empSet = new Set(unidades.map((u) => u.empreendimento_id));
  const faixas = unidades.reduce<{
    preco_min: number | null;
    preco_max: number | null;
    area_min: number | null;
    area_max: number | null;
  }>(
    (acc, u) => {
      if (u.preco_total != null) {
        acc.preco_min =
          acc.preco_min == null ? u.preco_total : Math.min(acc.preco_min, u.preco_total);
        acc.preco_max =
          acc.preco_max == null ? u.preco_total : Math.max(acc.preco_max, u.preco_total);
      }
      if (u.area_privativa != null) {
        acc.area_min =
          acc.area_min == null ? u.area_privativa : Math.min(acc.area_min, u.area_privativa);
        acc.area_max =
          acc.area_max == null ? u.area_privativa : Math.max(acc.area_max, u.area_privativa);
      }
      return acc;
    },
    { preco_min: null, preco_max: null, area_min: null, area_max: null },
  );

  return {
    ok: true,
    count: unidades.length,
    empreendimentos_com_match: empSet.size,
    unidades,
    faixas,
  };
}
