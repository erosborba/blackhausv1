import { supabaseAdmin } from "./supabase";
import type { ParsedTabelaPrecos, ParseWarning, ParsedUnidade } from "./tabela-precos-parser";

/**
 * Domínio de tabela de preços: persistência (upsert com source preservation),
 * consultas estruturadas pra Bia (por número, por filtros, por tipologia),
 * e lock otimista no confirm.
 *
 * Fluxo do upload:
 *   preview(parsed)   → só retorna; não escreve nada, não incrementa version.
 *   confirm(parsed, expected_version)
 *     → transação: upsert das unidades parseadas + incrementa version do
 *       header. Se expected_version != atual, 409 (conflito de admin
 *       trabalhando em preview velho).
 */

export type TabelaPrecosHeader = {
  id: string;
  empreendimento_id: string;
  version: number;
  file_path: string | null;
  file_name: string | null;
  file_hash: string | null;
  file_mime: string | null;
  entrega_prevista: string | null;
  disclaimers: string[];
  parse_warnings: ParseWarning[];
  parsed_rows_count: number;
  uploaded_at: string;
  uploaded_by: string | null;
};

export type UnidadeTabelaPrecos = {
  id: string;
  empreendimento_id: string;
  numero: string;
  andar: number | null;
  tipologia: string | null;
  tipologia_ref: string | null;
  area_privativa: number | null;
  area_terraco: number | null;
  preco_total: number | null;
  preco: number | null;
  plano_pagamento: ParsedUnidade["plano_pagamento"] | null;
  status: "avail" | "reserved" | "sold" | "unavailable";
  is_comercial: boolean;
  source: "manual" | "tabela_precos";
  notes: string | null;
};

// ─── READ: header ────────────────────────────────────────────────────────────

export async function getTabelaPrecosHeader(
  empreendimentoId: string,
): Promise<TabelaPrecosHeader | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimento_tabelas_precos")
    .select("*")
    .eq("empreendimento_id", empreendimentoId)
    .maybeSingle();
  if (error) {
    console.error("[tabela-precos] getHeader:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    empreendimento_id: String(row.empreendimento_id),
    version: Number(row.version ?? 1),
    file_path: (row.file_path as string | null) ?? null,
    file_name: (row.file_name as string | null) ?? null,
    file_hash: (row.file_hash as string | null) ?? null,
    file_mime: (row.file_mime as string | null) ?? null,
    entrega_prevista: (row.entrega_prevista as string | null) ?? null,
    disclaimers: Array.isArray(row.disclaimers) ? (row.disclaimers as string[]) : [],
    parse_warnings: Array.isArray(row.parse_warnings)
      ? (row.parse_warnings as ParseWarning[])
      : [],
    parsed_rows_count: Number(row.parsed_rows_count ?? 0),
    uploaded_at: String(row.uploaded_at),
    uploaded_by: (row.uploaded_by as string | null) ?? null,
  };
}

// ─── READ: consulta por número ───────────────────────────────────────────────

export type UnidadeLookup = {
  id: string;
  numero: string;
  andar: number | null;
  tipologia: string | null;
  tipologia_ref: string | null;
  area_privativa: number | null;
  area_terraco: number | null;
  preco_total: number | null;
  plano_pagamento: ParsedUnidade["plano_pagamento"] | null;
  status: "avail" | "reserved" | "sold" | "unavailable";
  is_comercial: boolean;
  source: "manual" | "tabela_precos";
};

export async function consultarUnidadePorNumero(
  empreendimentoId: string,
  numero: string,
): Promise<UnidadeLookup | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .rpc("unidade_por_numero", {
      p_empreendimento_id: empreendimentoId,
      p_numero: numero,
    })
    .maybeSingle();
  if (error) {
    console.error("[tabela-precos] unidade_por_numero:", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    numero: String(r.numero),
    andar: r.andar == null ? null : Number(r.andar),
    tipologia: (r.tipologia as string | null) ?? null,
    tipologia_ref: (r.tipologia_ref as string | null) ?? null,
    area_privativa: toNumOrNull(r.area_privativa),
    area_terraco: toNumOrNull(r.area_terraco),
    preco_total: toNumOrNull(r.preco_total),
    plano_pagamento: (r.plano_pagamento as ParsedUnidade["plano_pagamento"] | null) ?? null,
    status: (r.status as UnidadeLookup["status"]) ?? "avail",
    is_comercial: Boolean(r.is_comercial),
    source: (r.source as UnidadeLookup["source"]) ?? "manual",
  };
}

// ─── READ: filtrar ───────────────────────────────────────────────────────────

export type FiltrarInput = {
  empreendimentoId: string;
  tipologia?: string | null;
  preco_min?: number | null;
  preco_max?: number | null;
  area_min?: number | null;
  andar_min?: number | null;
  andar_max?: number | null;
  apenas_disponiveis?: boolean;
  is_comercial?: boolean | null;
  limit?: number;
};

export type UnidadeFiltrada = {
  id: string;
  numero: string;
  andar: number | null;
  tipologia: string | null;
  area_privativa: number | null;
  area_terraco: number | null;
  preco_total: number | null;
  plano_pagamento: ParsedUnidade["plano_pagamento"] | null;
  status: "avail" | "reserved" | "sold" | "unavailable";
  is_comercial: boolean;
};

export async function filtrarUnidades(input: FiltrarInput): Promise<UnidadeFiltrada[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("unidades_filtrar", {
    p_empreendimento_id: input.empreendimentoId,
    p_tipologia: input.tipologia ?? null,
    p_preco_min: input.preco_min ?? null,
    p_preco_max: input.preco_max ?? null,
    p_area_min: input.area_min ?? null,
    p_andar_min: input.andar_min ?? null,
    p_andar_max: input.andar_max ?? null,
    p_apenas_disponiveis: input.apenas_disponiveis ?? true,
    p_is_comercial: input.is_comercial ?? null,
    p_limit: input.limit ?? 20,
  });
  if (error) {
    console.error("[tabela-precos] filtrar:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    numero: String(r.numero),
    andar: r.andar == null ? null : Number(r.andar),
    tipologia: (r.tipologia as string | null) ?? null,
    area_privativa: toNumOrNull(r.area_privativa),
    area_terraco: toNumOrNull(r.area_terraco),
    preco_total: toNumOrNull(r.preco_total),
    plano_pagamento: (r.plano_pagamento as ParsedUnidade["plano_pagamento"] | null) ?? null,
    status: (r.status as UnidadeFiltrada["status"]) ?? "avail",
    is_comercial: Boolean(r.is_comercial),
  }));
}

// ─── READ: filtrar multi-empreendimento ──────────────────────────────────────

export type FiltrarMultiInput = {
  /** Null = todos os empreendimentos ativos. */
  empreendimentoIds?: string[] | null;
  tipologia?: string | null;
  preco_min?: number | null;
  preco_max?: number | null;
  area_min?: number | null;
  andar_min?: number | null;
  andar_max?: number | null;
  apenas_disponiveis?: boolean;
  is_comercial?: boolean | null;
  /** Top-N por empreendimento (default 5). */
  limit_per_emp?: number;
  /** Cap total agregado (default 30). */
  limit_total?: number;
};

export type UnidadeMulti = UnidadeFiltrada & {
  empreendimento_id: string;
  empreendimento_nome: string;
};

export async function filtrarUnidadesMulti(
  input: FiltrarMultiInput,
): Promise<UnidadeMulti[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("unidades_filtrar_multi", {
    p_empreendimento_ids: input.empreendimentoIds ?? null,
    p_tipologia: input.tipologia ?? null,
    p_preco_min: input.preco_min ?? null,
    p_preco_max: input.preco_max ?? null,
    p_area_min: input.area_min ?? null,
    p_andar_min: input.andar_min ?? null,
    p_andar_max: input.andar_max ?? null,
    p_apenas_disponiveis: input.apenas_disponiveis ?? true,
    p_is_comercial: input.is_comercial ?? null,
    p_limit_per_emp: input.limit_per_emp ?? 5,
    p_limit_total: input.limit_total ?? 30,
  });
  if (error) {
    console.error("[tabela-precos] filtrar_multi:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    empreendimento_id: String(r.empreendimento_id),
    empreendimento_nome: String(r.empreendimento_nome),
    id: String(r.id),
    numero: String(r.numero),
    andar: r.andar == null ? null : Number(r.andar),
    tipologia: (r.tipologia as string | null) ?? null,
    area_privativa: toNumOrNull(r.area_privativa),
    area_terraco: toNumOrNull(r.area_terraco),
    preco_total: toNumOrNull(r.preco_total),
    plano_pagamento: (r.plano_pagamento as ParsedUnidade["plano_pagamento"] | null) ?? null,
    status: (r.status as UnidadeFiltrada["status"]) ?? "avail",
    is_comercial: Boolean(r.is_comercial),
  }));
}

// ─── READ: tipologias ────────────────────────────────────────────────────────

export type TipologiaResumo = {
  tipologia: string;
  is_comercial: boolean;
  total: number;
  disponivel: number;
  preco_a_partir: number | null;
  preco_ate: number | null;
  area_min: number | null;
  area_max: number | null;
};

export async function listarTipologias(
  empreendimentoId: string,
): Promise<TipologiaResumo[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("unidades_tipologias", {
    p_empreendimento_id: empreendimentoId,
  });
  if (error) {
    console.error("[tabela-precos] tipologias:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    tipologia: String(r.tipologia),
    is_comercial: Boolean(r.is_comercial),
    total: Number(r.total ?? 0),
    disponivel: Number(r.disponivel ?? 0),
    preco_a_partir: toNumOrNull(r.preco_a_partir),
    preco_ate: toNumOrNull(r.preco_ate),
    area_min: toNumOrNull(r.area_min),
    area_max: toNumOrNull(r.area_max),
  }));
}

// ─── WRITE: confirm (com lock otimista) ──────────────────────────────────────

export type ConfirmInput = {
  empreendimentoId: string;
  parsed: ParsedTabelaPrecos;
  /** Path no bucket storage (já upado pelo caller) — opcional. */
  filePath?: string | null;
  uploadedBy?: string | null;
  /** Version esperada do header (0 se primeira vez). Se divergir, 409. */
  expectedVersion: number;
};

export type ConfirmResult =
  | {
      ok: true;
      header: TabelaPrecosHeader;
      inserted: number;
      updated: number;
      preserved_manual: number;
      orphaned: number;
    }
  | { ok: false; code: "version_conflict"; current_version: number }
  | { ok: false; code: "db_error"; error: string };

/**
 * Persiste as unidades parseadas. Semântica:
 *
 *  1. Confere `empreendimento_tabelas_precos.version` == expectedVersion.
 *     Se não, devolve version_conflict (outro admin já commitou).
 *
 *  2. Pra cada unidade parseada, upsert em `unidades`:
 *     - Se existe linha com mesmo (empreendimento_id, lower(numero)) e
 *       source='tabela_precos': atualiza TUDO menos `status` (status pode
 *       ter virado sold/reserved manualmente após o upload anterior).
 *     - Se existe com source='manual': NÃO toca (o corretor criou à mão —
 *       dataset dele vence). Conta em `preserved_manual`.
 *     - Se não existe: insere com source='tabela_precos', status='avail'.
 *
 *  3. Unidades que estavam em source='tabela_precos' com version anterior
 *     mas não apareceram na nova tabela ficam como "orphaned":
 *     marcadas status='unavailable' + notes incluindo "removida do upload vN".
 *     NÃO deletamos pra preservar histórico de visits que referenciem essa
 *     unidade (FK SET NULL evitaria, mas auditoria é melhor).
 *
 *  4. Atualiza header com version+1, metadata nova, warnings.
 *
 * Nota sobre atomicidade: o Supabase JS não expõe transações client-side;
 * rodamos como bulk ops sequenciais. Pra nosso workload (~130 rows, admin
 * único por vez na prática), a janela de inconsistência é < 1s. O lock
 * otimista no header é a garantia forte contra race entre admins. Pra
 * atomicidade hard, migrar pra uma RPC plpgsql no futuro — tech-debt
 * aceito agora.
 */
export async function confirmarTabelaPrecos(input: ConfirmInput): Promise<ConfirmResult> {
  const sb = supabaseAdmin();

  const { data: headerRow, error: headerErr } = await sb
    .from("empreendimento_tabelas_precos")
    .select("id, version")
    .eq("empreendimento_id", input.empreendimentoId)
    .maybeSingle();
  if (headerErr) {
    return { ok: false, code: "db_error", error: headerErr.message };
  }
  const currentVersion = headerRow ? Number((headerRow as Record<string, unknown>).version ?? 1) : 0;

  // expectedVersion == 0 = primeiro upload (header ainda não existe).
  // Qualquer outro valor precisa bater exatamente.
  if (input.expectedVersion !== currentVersion) {
    return { ok: false, code: "version_conflict", current_version: currentVersion };
  }

  // Carrega unidades existentes da tabela_precos da versão anterior —
  // pra detectar órfãs e decidir preserved_manual.
  const { data: existingRows, error: existingErr } = await sb
    .from("unidades")
    .select("id, numero, source, status, notes, tabela_precos_version")
    .eq("empreendimento_id", input.empreendimentoId);
  if (existingErr) {
    return { ok: false, code: "db_error", error: existingErr.message };
  }
  const existing = (existingRows ?? []) as Array<{
    id: string;
    numero: string;
    source: "manual" | "tabela_precos";
    status: UnidadeLookup["status"];
    notes: string | null;
    tabela_precos_version: number | null;
  }>;
  const byNumeroLower = new Map(existing.map((u) => [u.numero.toLowerCase(), u]));

  const newVersion = currentVersion + 1;

  let inserted = 0;
  let updated = 0;
  let preserved_manual = 0;
  const parsedKeys = new Set<string>();

  for (const u of input.parsed.unidades) {
    const key = u.numero.toLowerCase();
    parsedKeys.add(key);
    const prior = byNumeroLower.get(key);

    if (prior && prior.source === "manual") {
      // Manual vence. Não tocamos — mas logamos pra relatório.
      preserved_manual++;
      continue;
    }

    const row = {
      empreendimento_id: input.empreendimentoId,
      andar: u.andar ?? inferAndarFromNumero(u.numero),
      numero: u.numero,
      tipologia: u.tipologia,
      tipologia_ref: u.tipologia, // mantém paridade com o ref legacy.
      area_privativa: u.area_privativa,
      area_terraco: u.area_terraco,
      preco_total: u.preco_total,
      preco: u.preco_total,
      plano_pagamento: u.plano_pagamento,
      is_comercial: u.is_comercial,
      source: "tabela_precos" as const,
      raw_row: u,
      tabela_precos_version: newVersion,
    };

    if (prior) {
      // Update: preserva status atual (pode ter virado sold depois).
      const { error } = await sb
        .from("unidades")
        .update(row)
        .eq("id", prior.id);
      if (error) return { ok: false, code: "db_error", error: error.message };
      updated++;
    } else {
      const { error } = await sb
        .from("unidades")
        .insert({ ...row, status: "avail" });
      if (error) return { ok: false, code: "db_error", error: error.message };
      inserted++;
    }
  }

  // Órfãs: estavam em tabela_precos na versão anterior e não voltaram.
  // Marca unavailable + nota de auditoria. Ignora source='manual'.
  let orphaned = 0;
  for (const prior of existing) {
    if (prior.source !== "tabela_precos") continue;
    if (parsedKeys.has(prior.numero.toLowerCase())) continue;
    const noteMark = `[removida do upload v${newVersion} em ${new Date().toISOString().slice(0, 10)}]`;
    const newNotes = prior.notes ? `${prior.notes}\n${noteMark}` : noteMark;
    const { error } = await sb
      .from("unidades")
      .update({ status: "unavailable", notes: newNotes })
      .eq("id", prior.id);
    if (error) return { ok: false, code: "db_error", error: error.message };
    orphaned++;
  }

  // Header upsert: insert se não existe, update com version++.
  const headerPayload = {
    empreendimento_id: input.empreendimentoId,
    version: newVersion,
    file_path: input.filePath ?? null,
    file_name: input.parsed.file.name,
    file_hash: input.parsed.file.hash,
    file_mime: input.parsed.file.mime,
    entrega_prevista: input.parsed.entrega_prevista,
    disclaimers: input.parsed.disclaimers,
    parse_warnings: input.parsed.warnings,
    parsed_rows_count: input.parsed.unidades.length,
    uploaded_at: new Date().toISOString(),
    uploaded_by: input.uploadedBy ?? null,
  };

  if (headerRow) {
    const { error } = await sb
      .from("empreendimento_tabelas_precos")
      .update(headerPayload)
      .eq("empreendimento_id", input.empreendimentoId)
      // Garantia extra contra race (caso o first read tenha mostrado versão
      // X, mas alguém tenha commitado entre o read e esse update).
      .eq("version", currentVersion);
    if (error) return { ok: false, code: "db_error", error: error.message };
  } else {
    const { error } = await sb.from("empreendimento_tabelas_precos").insert(headerPayload);
    if (error) return { ok: false, code: "db_error", error: error.message };
  }

  const header = await getTabelaPrecosHeader(input.empreendimentoId);
  if (!header) {
    return { ok: false, code: "db_error", error: "header not found after write" };
  }
  return { ok: true, header, inserted, updated, preserved_manual, orphaned };
}

/** Remove a tabela (zera unidades source='tabela_precos', apaga header). */
export async function removerTabelaPrecos(
  empreendimentoId: string,
  expectedVersion: number,
): Promise<
  | { ok: true }
  | { ok: false; code: "version_conflict"; current_version: number }
  | { ok: false; code: "db_error"; error: string }
> {
  const sb = supabaseAdmin();
  const { data: headerRow, error: headerErr } = await sb
    .from("empreendimento_tabelas_precos")
    .select("version")
    .eq("empreendimento_id", empreendimentoId)
    .maybeSingle();
  if (headerErr) return { ok: false, code: "db_error", error: headerErr.message };
  const currentVersion = headerRow ? Number((headerRow as Record<string, unknown>).version ?? 1) : 0;
  if (currentVersion !== expectedVersion) {
    return { ok: false, code: "version_conflict", current_version: currentVersion };
  }

  const { error: delUnErr } = await sb
    .from("unidades")
    .delete()
    .eq("empreendimento_id", empreendimentoId)
    .eq("source", "tabela_precos");
  if (delUnErr) return { ok: false, code: "db_error", error: delUnErr.message };

  const { error: delHdrErr } = await sb
    .from("empreendimento_tabelas_precos")
    .delete()
    .eq("empreendimento_id", empreendimentoId);
  if (delHdrErr) return { ok: false, code: "db_error", error: delHdrErr.message };
  return { ok: true };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Heurística pt-BR: numeração "<andar><unidade_no_andar>" com 2 últimos
 * dígitos = unidade. 1811 → 18. 301 → 3. 2908 → 29. L01 → null (loja).
 * Usado só como fallback quando o parser não retorna andar explícito.
 */
function inferAndarFromNumero(numero: string): number | null {
  const digits = numero.replace(/\D/g, "");
  if (!digits || digits.length < 3) return null;
  const andar = Number(digits.slice(0, -2));
  return Number.isFinite(andar) && andar > 0 ? andar : null;
}
