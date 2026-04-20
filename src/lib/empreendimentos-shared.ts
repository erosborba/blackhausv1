/**
 * Tipos + helpers puros de empreendimentos.
 *
 * Esse arquivo é seguro pra importar em Client Components — não toca em
 * supabase/openai/env. O módulo "pesado" (`./empreendimentos`) re-exporta
 * tudo daqui e adiciona `reindexEmpreendimento`, que é server-only.
 */

export type Tipologia = {
  quartos?: number | null;
  suites?: number | null;
  vagas?: number | null;
  area?: number | null;
  preco?: number | null;
};

export type Midia = {
  type: "pdf" | "sheet" | "image" | "other";
  name: string;
  path: string;
  size: number;
  added_at?: string;
};

/**
 * Chunk de conhecimento bruto extraído pelo Claude de um doc uploaded.
 * Diferente de `Midia` (metadata do arquivo), isso é o CONTEÚDO semântico
 * segmentado — a Bia consulta isso via RAG.
 */
export type RawKnowledge = {
  section: string;        // rótulo curto (ex: "Acabamentos", "Fachada")
  text: string;           // conteúdo com palavras-chave do original
  source_file: string;    // nome do arquivo de origem
  added_at: string;       // ISO timestamp
};

/** FAQ cadastrada pelo corretor ou gerada pela IA. */
export type Faq = {
  id: string;
  empreendimento_id: string;
  question: string;
  answer: string;
  source: "manual" | "ai_generated";
  created_at: string;
  updated_at: string;
};

export type Empreendimento = {
  id: string;
  nome: string;
  slug: string | null;
  construtora: string | null;
  status: "lancamento" | "em_obras" | "pronto_para_morar" | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  preco_inicial: number | null;
  tipologias: Tipologia[];
  diferenciais: string[];
  lazer: string[];
  entrega: string | null;
  descricao: string | null;
  midias: Midia[];
  /** Chunks extraídos do Claude na hora do upload (fonte pro RAG profundo). */
  raw_knowledge: RawKnowledge[];
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

/** Dados que a IA devolve depois de extrair de PDFs/planilhas/imagens. */
export type ExtractedData = {
  nome?: string | null;
  construtora?: string | null;
  status?: Empreendimento["status"];
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  preco_inicial?: number | null;
  tipologias?: Tipologia[];
  diferenciais?: string[];
  lazer?: string[];
  entrega?: string | null;
  descricao?: string | null;
};

// ─── Chunking ────────────────────────────────────────────────────────────────

export type Chunk = { content: string; metadata: Record<string, unknown> };

export function chunkEmpreendimento(e: Empreendimento, faqs: Faq[] = []): Chunk[] {
  const base = `Empreendimento ${e.nome} — ${e.bairro ?? ""}, ${e.cidade ?? ""} — ${e.status ?? ""}.`;
  const chunks: Chunk[] = [];
  if (e.descricao) {
    chunks.push({ content: `${base}\nDescrição: ${e.descricao}`, metadata: { kind: "descricao" } });
  }
  if (Array.isArray(e.tipologias) && e.tipologias.length) {
    chunks.push({
      content: `${base}\nTipologias: ${e.tipologias
        .map((t) => `${t.quartos ?? "?"}q, ${t.area ?? "?"}m², ~R$${t.preco ?? "?"}`)
        .join("; ")}`,
      metadata: { kind: "tipologias" },
    });
  }
  if (Array.isArray(e.diferenciais) && e.diferenciais.length) {
    chunks.push({
      content: `${base}\nDiferenciais: ${e.diferenciais.join(", ")}`,
      metadata: { kind: "diferenciais" },
    });
  }
  if (Array.isArray(e.lazer) && e.lazer.length) {
    chunks.push({ content: `${base}\nLazer: ${e.lazer.join(", ")}`, metadata: { kind: "lazer" } });
  }

  // Chunks de conhecimento bruto extraído dos docs.
  if (Array.isArray(e.raw_knowledge)) {
    for (const rk of e.raw_knowledge) {
      if (!rk?.text?.trim()) continue;
      chunks.push({
        content: `${base}\n${rk.section}: ${rk.text}`,
        metadata: {
          kind: "raw",
          section: rk.section,
          source_file: rk.source_file || null,
        },
      });
    }
  }

  // FAQ: cada par pergunta+resposta vira um chunk.
  for (const f of faqs) {
    if (!f.question?.trim() || !f.answer?.trim()) continue;
    chunks.push({
      content: `${base}\nFAQ — ${f.question}\n${f.answer}`,
      metadata: { kind: "faq", faq_id: f.id, source: f.source },
    });
  }

  return chunks;
}

// ─── Merge ───────────────────────────────────────────────────────────────────

/** Normalização pra dedup case-insensitive + sem acento. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Merge dedup em array de strings (mantém ordem, nova entrada vai pro fim). */
function mergeStrings(current: string[], incoming: string[] | undefined): string[] {
  if (!incoming || !incoming.length) return current;
  const seen = new Set(current.map(norm));
  const out = [...current];
  for (const s of incoming) {
    if (!s) continue;
    const clean = s.trim();
    if (!clean) continue;
    const k = norm(clean);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
  }
  return out;
}

/** Chave de dedup pra tipologia: (quartos, area). Se a nova preencher campos
 *  que faltavam na atual (ex.: preço), mescla. */
function mergeTipologias(current: Tipologia[], incoming: Tipologia[] | undefined): Tipologia[] {
  if (!incoming || !incoming.length) return current;
  const keyOf = (t: Tipologia) => `${t.quartos ?? "?"}|${t.area ?? "?"}`;
  const map = new Map<string, Tipologia>();
  for (const t of current) map.set(keyOf(t), t);
  for (const t of incoming) {
    const k = keyOf(t);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, t);
    } else {
      map.set(k, {
        quartos: existing.quartos ?? t.quartos,
        suites: existing.suites ?? t.suites,
        vagas: existing.vagas ?? t.vagas,
        area: existing.area ?? t.area,
        preco: existing.preco ?? t.preco,
      });
    }
  }
  return Array.from(map.values());
}

/** Mantém o valor atual se não estiver vazio; senão usa o novo. */
function preferCurrent<T>(current: T | null | undefined, incoming: T | null | undefined): T | null {
  if (current !== null && current !== undefined && current !== "") return current as T;
  return (incoming ?? null) as T | null;
}

/**
 * Faz merge dos dados extraídos numa base atual.
 *
 * Regras:
 *  - Strings/enums: mantém o atual se já preenchido.
 *  - preco_inicial: usa o MENOR dos dois ("a partir de").
 *  - Arrays (diferenciais/lazer): concatena com dedup sem acento.
 *  - Tipologias: merge por (quartos, area); se já existe, preenche lacunas.
 */
export function mergeExtracted(
  current: Empreendimento,
  extracted: ExtractedData,
): Partial<Empreendimento> {
  const patch: Partial<Empreendimento> = {};
  const stringFields = [
    "nome",
    "construtora",
    "status",
    "endereco",
    "bairro",
    "cidade",
    "estado",
    "entrega",
    "descricao",
  ] as const;
  for (const f of stringFields) {
    const merged = preferCurrent(current[f] as string | null, extracted[f] as string | null | undefined);
    if (merged !== current[f]) (patch as Record<string, unknown>)[f] = merged;
  }

  if (extracted.preco_inicial != null) {
    if (current.preco_inicial == null || extracted.preco_inicial < current.preco_inicial) {
      patch.preco_inicial = extracted.preco_inicial;
    }
  }

  const newDif = mergeStrings(current.diferenciais ?? [], extracted.diferenciais);
  if (newDif.length !== (current.diferenciais?.length ?? 0)) patch.diferenciais = newDif;

  const newLaz = mergeStrings(current.lazer ?? [], extracted.lazer);
  if (newLaz.length !== (current.lazer?.length ?? 0)) patch.lazer = newLaz;

  const newTipo = mergeTipologias(current.tipologias ?? [], extracted.tipologias);
  if (JSON.stringify(newTipo) !== JSON.stringify(current.tipologias ?? [])) {
    patch.tipologias = newTipo;
  }

  return patch;
}

/**
 * Concatena raw_knowledge novos ao atual. Não faz dedup profundo (texto
 * bruto dificilmente é 100% idêntico entre uploads); deixa o corretor
 * limpar manualmente se precisar.
 */
export function mergeRawKnowledge(
  current: RawKnowledge[] | null | undefined,
  incoming: RawKnowledge[],
): RawKnowledge[] {
  const base = Array.isArray(current) ? current : [];
  if (!incoming?.length) return base;
  return [...base, ...incoming];
}

// ─── Gaps ────────────────────────────────────────────────────────────────────

export type Gap = {
  field: string;          // chave técnica ("preco_inicial", "tipologias_preco")
  label: string;          // texto pro usuário
  severity: "high" | "medium" | "low";
  hint?: string;          // sugestão de como resolver
};

/**
 * Detecta lacunas no cadastro. Usado no dashboard pra o corretor priorizar
 * o que ainda precisa ser alimentado (a Bia rende melhor com cadastro
 * completo).
 */
export function computeGaps(e: Empreendimento, faqCount = 0): Gap[] {
  const gaps: Gap[] = [];

  if (e.preco_inicial == null) {
    gaps.push({
      field: "preco_inicial",
      label: "Sem preço inicial",
      severity: "high",
      hint: "Suba a tabela de preços ou edite manualmente.",
    });
  }
  if (!Array.isArray(e.tipologias) || e.tipologias.length === 0) {
    gaps.push({
      field: "tipologias",
      label: "Sem tipologias cadastradas",
      severity: "high",
      hint: "Suba o book comercial pra IA extrair.",
    });
  } else {
    const missingPrice = e.tipologias.some((t) => t.preco == null);
    if (missingPrice) {
      gaps.push({
        field: "tipologias_preco",
        label: "Tipologia(s) sem preço",
        severity: "medium",
      });
    }
  }
  if (!e.entrega) {
    gaps.push({ field: "entrega", label: "Sem data de entrega", severity: "high" });
  }
  if (!e.endereco && !e.bairro) {
    gaps.push({
      field: "localizacao",
      label: "Sem endereço/bairro",
      severity: "high",
      hint: "Essencial pra IA filtrar por região.",
    });
  }
  if (!e.construtora) {
    gaps.push({ field: "construtora", label: "Sem incorporadora", severity: "medium" });
  }
  if (!e.descricao) {
    gaps.push({
      field: "descricao",
      label: "Sem descrição",
      severity: "medium",
      hint: "Um resumo curto ajuda a IA a contextualizar.",
    });
  }
  if (!Array.isArray(e.diferenciais) || e.diferenciais.length === 0) {
    gaps.push({ field: "diferenciais", label: "Sem diferenciais", severity: "medium" });
  }
  if (!Array.isArray(e.midias) || e.midias.length === 0) {
    gaps.push({
      field: "midias",
      label: "Sem documentos anexados",
      severity: "low",
      hint: "Book/memorial/tabela enriquecem o RAG profundo.",
    });
  }
  if (!Array.isArray(e.raw_knowledge) || e.raw_knowledge.length === 0) {
    gaps.push({
      field: "raw_knowledge",
      label: "Sem conhecimento bruto",
      severity: "low",
      hint: "A IA consegue responder campos estruturados, mas não perguntas técnicas específicas.",
    });
  }
  if (faqCount === 0) {
    gaps.push({ field: "faq", label: "Sem FAQ", severity: "low" });
  }

  return gaps;
}
