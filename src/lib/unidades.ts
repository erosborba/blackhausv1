import { supabaseAdmin } from "./supabase";

/**
 * Domínio de unidades (estoque físico de um empreendimento).
 *
 * `status` é a fonte de verdade de disponibilidade — consumido por:
 *  - Agent tool `check_availability` (Bia consulta em tempo real)
 *  - /empreendimentos/[id] aba Unidades (matriz por andar)
 *  - Card de summary no detail view (total / avail / reserved / sold)
 *
 * Tipologia_ref é texto livre pra juntar com `empreendimentos.tipologias`
 * (JSONB). Mantido frouxo de propósito — não queremos normalizar antes da
 * hora porque cada empreendimento modela tipologias do seu jeito.
 */

export type UnidadeStatus = "avail" | "reserved" | "sold" | "unavailable";

export const UNIDADE_STATUS_LABEL: Record<UnidadeStatus, string> = {
  avail: "Disponível",
  reserved: "Reservada",
  sold: "Vendida",
  unavailable: "Indisponível",
};

export type Unidade = {
  id: string;
  empreendimento_id: string;
  andar: number;
  numero: string;
  tipologia_ref: string | null;
  preco: number | null;
  status: UnidadeStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type UnidadeMatrixRow = {
  andar: number;
  unidades: Array<{
    id: string;
    numero: string;
    status: UnidadeStatus;
    preco: number | null;
    tipologia_ref: string | null;
    notes: string | null;
  }>;
};

export type UnidadeSummary = {
  total: number;
  avail: number;
  reserved: number;
  sold: number;
  unavailable: number;
  min_preco: number | null;
  max_preco: number | null;
};

// ============================================================
// READS
// ============================================================

export async function getUnidadesMatrix(empreendimentoId: string): Promise<UnidadeMatrixRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("unidades_matrix", {
    p_empreendimento_id: empreendimentoId,
  });
  if (error) {
    console.error("[unidades] matrix:", error.message);
    return [];
  }
  return (data ?? []) as UnidadeMatrixRow[];
}

export async function getUnidadesSummary(empreendimentoId: string): Promise<UnidadeSummary> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .rpc("unidades_summary", { p_empreendimento_id: empreendimentoId })
    .maybeSingle();
  if (error) {
    console.error("[unidades] summary:", error.message);
    return emptySummary();
  }
  const row = data as Record<string, number | null> | null;
  if (!row) return emptySummary();
  return {
    total: Number(row.total ?? 0),
    avail: Number(row.avail ?? 0),
    reserved: Number(row.reserved ?? 0),
    sold: Number(row.sold ?? 0),
    unavailable: Number(row.unavailable ?? 0),
    min_preco: row.min_preco === null ? null : Number(row.min_preco),
    max_preco: row.max_preco === null ? null : Number(row.max_preco),
  };
}

function emptySummary(): UnidadeSummary {
  return { total: 0, avail: 0, reserved: 0, sold: 0, unavailable: 0, min_preco: null, max_preco: null };
}

export async function listUnidades(empreendimentoId: string): Promise<Unidade[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("unidades")
    .select("*")
    .eq("empreendimento_id", empreendimentoId)
    .order("andar", { ascending: false })
    .order("numero", { ascending: true });
  if (error) {
    console.error("[unidades] list:", error.message);
    return [];
  }
  return (data ?? []) as Unidade[];
}

/**
 * Lista unidades disponíveis (filtro opcional de tipologia). Usado pelo
 * agent tool `check_availability` — ordena por preço asc pra retornar
 * "a partir de R$ X" facilmente.
 */
export async function listAvailableUnidades(
  empreendimentoId: string,
  tipologiaRef?: string | null,
): Promise<Unidade[]> {
  const sb = supabaseAdmin();
  let q = sb
    .from("unidades")
    .select("*")
    .eq("empreendimento_id", empreendimentoId)
    .eq("status", "avail")
    .order("preco", { ascending: true, nullsFirst: false });
  if (tipologiaRef) q = q.eq("tipologia_ref", tipologiaRef);
  const { data, error } = await q;
  if (error) {
    console.error("[unidades] listAvailable:", error.message);
    return [];
  }
  return (data ?? []) as Unidade[];
}

// ============================================================
// WRITES
// ============================================================

export type CreateUnidadeInput = {
  empreendimento_id: string;
  andar: number;
  numero: string;
  tipologia_ref?: string | null;
  preco?: number | null;
  status?: UnidadeStatus;
  notes?: string | null;
};

export async function createUnidade(input: CreateUnidadeInput): Promise<Unidade | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("unidades")
    .insert({
      empreendimento_id: input.empreendimento_id,
      andar: input.andar,
      numero: input.numero,
      tipologia_ref: input.tipologia_ref ?? null,
      preco: input.preco ?? null,
      status: input.status ?? "avail",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[unidades] create:", error.message);
    return null;
  }
  return data as Unidade;
}

export async function updateUnidadeStatus(
  id: string,
  status: UnidadeStatus,
  notes?: string | null,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = { status };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await sb.from("unidades").update(patch).eq("id", id);
  if (error) {
    console.error("[unidades] updateStatus:", error.message);
    return false;
  }
  return true;
}

export async function updateUnidade(
  id: string,
  patch: Partial<Pick<Unidade, "andar" | "numero" | "tipologia_ref" | "preco" | "status" | "notes">>,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("unidades").update(patch).eq("id", id);
  if (error) {
    console.error("[unidades] update:", error.message);
    return false;
  }
  return true;
}

export async function deleteUnidade(id: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("unidades").delete().eq("id", id);
  if (error) {
    console.error("[unidades] delete:", error.message);
    return false;
  }
  return true;
}

/**
 * Formatação humana de um range de preços pra UI/agente.
 * Ex: "R$ 450 mil – 820 mil" ou "a partir de R$ 450 mil".
 */
export function formatPrecoRange(summary: UnidadeSummary): string | null {
  const { min_preco, max_preco } = summary;
  if (min_preco == null && max_preco == null) return null;
  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  if (min_preco != null && max_preco != null && min_preco !== max_preco) {
    return `${fmt(min_preco)} – ${fmt(max_preco)}`;
  }
  return `a partir de ${fmt(min_preco ?? max_preco ?? 0)}`;
}
