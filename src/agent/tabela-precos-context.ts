import { supabaseAdmin } from "@/lib/supabase";
import {
  consultarUnidade,
  filtrarUnidades,
  listarTipologias,
  resumoTabelaPrecos,
} from "./tools";
import type { RetrievedSource } from "./retrieval";

/**
 * Pre-tool-call hook: decide se a mensagem do lead precisa da tabela de
 * preços estruturada e, se precisa, chama a tool adequada e retorna um
 * bloco de texto injetado no system prompt (ao lado do bloco RAG).
 *
 * Por que aqui e não em answerNode com tool_use nativo: resolve 95% dos
 * casos (consulta por número, filtro por tipo/preço) sem mudar o modelo
 * de execução da Bia. Próxima iteração promove pra tool_use loop (ver
 * docs/TECH_DEBT.md "Bia tool_use — fase B").
 *
 * Detecção em camadas:
 *  1. Resolve empreendimento alvo (prioridade: nome na mensagem > top
 *     retrievedSource > leadMemory). Sem alvo → nada.
 *  2. Classifica intent de consulta com regex/heurística barata:
 *     - número de unidade ("1811", "L01") → consultar_unidade
 *     - tipologia + filtro de preço/área → filtrar_unidades
 *     - "o que tem / tipologias / opções" → listar_tipologias
 *  3. Chama a tool, formata bloco TABELA_PRECOS_MATCH.
 */

const EMPREENDIMENTO_NAME_MIN = 4; // "Aya" tem 3, mas match "aya " com espaço evita falso positivo

export async function buildTabelaPrecosBlock(input: {
  lastUserText: string;
  leadMemory: string;
  retrievedSources: RetrievedSource[];
}): Promise<string | null> {
  const text = input.lastUserText.trim();
  if (!text) return null;

  // 1. Resolve empreendimento
  const emp = await pickEmpreendimento(text, input.retrievedSources, input.leadMemory);
  if (!emp) return null;

  // 2. Classifica sub-intent
  const sub = classifyQueryIntent(text);
  if (!sub) return null;

  // 3. Chama a tool e monta o bloco
  if (sub.kind === "unidade_por_numero") {
    const r = await consultarUnidade({
      empreendimento_id: emp.id,
      numero: sub.numero,
    });
    return renderConsultarUnidadeBlock(emp.nome, sub.numero, r);
  }

  if (sub.kind === "filtrar") {
    const r = await filtrarUnidades({
      empreendimento_id: emp.id,
      tipologia: sub.tipologia ?? null,
      preco_max: sub.preco_max ?? null,
      preco_min: sub.preco_min ?? null,
      is_comercial: sub.is_comercial ?? null,
      apenas_disponiveis: true,
      limit: 10,
    });
    return renderFiltrarBlock(emp.nome, sub, r);
  }

  if (sub.kind === "listar_tipologias") {
    const r = await listarTipologias({ empreendimento_id: emp.id });
    return renderListarTipologiasBlock(emp.nome, r);
  }

  if (sub.kind === "resumo") {
    const r = await resumoTabelaPrecos({ empreendimento_id: emp.id });
    return renderResumoBlock(emp.nome, r);
  }

  return null;
}

function renderResumoBlock(
  nome: string,
  r: Awaited<ReturnType<typeof resumoTabelaPrecos>>,
): string {
  if (!r.ok) {
    if (r.reason === "tabela_nao_cadastrada") {
      return `TABELA_PRECOS_MATCH (${nome}): tabela_precos_disponivel=false. Diga ao lead que ainda não carregou a tabela pra esse empreendimento.`;
    }
    return `TABELA_PRECOS_MATCH: empreendimento "${nome}" não encontrado.`;
  }
  const entregaBR = r.entrega_prevista ? toBRDate(r.entrega_prevista) : null;
  const linhas: string[] = [
    `TABELA_PRECOS_MATCH (empreendimento: ${r.empreendimento_nome})`,
    `tabela_precos_disponivel=true`,
    `total_unidades=${r.total_unidades} · disponiveis=${r.disponiveis} (residenciais=${r.residenciais_disponiveis}, comerciais=${r.comerciais_disponiveis})`,
    `preco_range=${BRL(r.preco_range.min)} – ${BRL(r.preco_range.max)}`,
    // Entrega em dois formatos: ISO (fonte) + BR (pra factcheck casar quando
    // a Bia escreve "31/03/2030") + dígitos-puros.
    `entrega_prevista=${r.entrega_prevista ?? "—"}${entregaBR ? ` (${entregaBR})` : ""}`,
    `tipologias_disponiveis=${r.tipologias_disponiveis.join(", ") || "—"}`,
  ];
  if (r.disclaimers.length) {
    linhas.push(`disclaimers_oficiais:`);
    for (const d of r.disclaimers) linhas.push(`  · ${d}`);
  }
  linhas.push(
    `IMPORTANTE: responda pelos dados acima. Datas em formato YYYY-MM-DD — ao citar pro lead, converta pra "dia/mês/ano" (ex: 2030-03-31 → 31/03/2030).`,
  );
  return linhas.join("\n");
}

// ─── resolver empreendimento ─────────────────────────────────────────────────

async function pickEmpreendimento(
  text: string,
  sources: RetrievedSource[],
  leadMemory: string,
): Promise<{ id: string; nome: string } | null> {
  const normText = norm(text);
  const normMemory = norm(leadMemory);

  const all = await listActiveEmps();

  // (a) Nome COMPLETO na mensagem (ex: "Aya Residences Amintas").
  //     Ganha prioridade sobre qualquer outra coisa.
  for (const e of all) {
    const n = norm(e.nome);
    if (n.length < EMPREENDIMENTO_NAME_MIN) continue;
    if (normText.includes(n)) return e;
  }

  // (b) Nome COMPLETO na memória do lead. Vem ANTES de retrievedSources
  //     e de token curto porque a memória reflete a intenção do lead
  //     (o empreendimento que ele escolheu), enquanto retrievedSources
  //     é apenas o que o pgvector achou relevante — pode trazer outro
  //     empreendimento com nome/bairro parecido.
  for (const e of all) {
    const n = norm(e.nome);
    if (n.length < EMPREENDIMENTO_NAME_MIN) continue;
    if (normMemory.includes(n)) return e;
  }

  // (c) Token curto na mensagem (ex: "aya" em "aya amintas").
  //     Pode casar MÚLTIPLOS empreendimentos ("Aya Carlos" e "Aya
  //     Amintas" ambos começam com "aya"). Se casar mais de um,
  //     desiste (não tem como saber qual). Mensagem ambígua + sem
  //     memória clara → returna null e a Bia pergunta.
  const shortHits: Array<{ id: string; nome: string }> = [];
  for (const e of all) {
    const firstToken = norm(e.nome).split(" ")[0];
    if (!firstToken || firstToken.length < EMPREENDIMENTO_NAME_MIN) continue;
    if (normText.includes(firstToken)) shortHits.push(e);
  }
  if (shortHits.length === 1) return shortHits[0];

  // (d) Último recurso: top retrievedSource.
  //     Só confiamos se a memória estava vazia E a mensagem não
  //     mencionou nenhum nome — caso contrário, risco de pegar o
  //     empreendimento errado que o RAG trouxe por similaridade
  //     tópica (ex: "previsão de entrega" → top source = qualquer
  //     empreendimento em construção).
  if (!normMemory && sources.length > 0 && shortHits.length === 0) {
    const top = sources[0];
    return { id: top.empreendimentoId, nome: top.nome };
  }

  return null;
}

async function listActiveEmps(): Promise<Array<{ id: string; nome: string }>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .select("id, nome")
    .eq("ativo", true);
  if (error) return [];
  return (data ?? []) as Array<{ id: string; nome: string }>;
}

// ─── classificação de intent ─────────────────────────────────────────────────

type QueryIntent =
  | { kind: "unidade_por_numero"; numero: string }
  | {
      kind: "filtrar";
      tipologia: string | null;
      preco_min: number | null;
      preco_max: number | null;
      is_comercial: boolean | null;
    }
  | { kind: "listar_tipologias" }
  | { kind: "resumo" };

function classifyQueryIntent(text: string): QueryIntent | null {
  const t = norm(text);

  // (1) Número de unidade: "1811", "unidade 301", "apto 1812", "L01".
  // Precisamos evitar falsos positivos: "preço 400" → 400 não é unidade.
  // Heurística: match apenas se o número tem 3-4 dígitos E aparece como
  // palavra isolada (boundaries), OU prefixado por "unidade"/"apto"/"apt"/"ap"/"L".
  const numMatch = extractUnidadeNumero(text);
  if (numMatch) return { kind: "unidade_por_numero", numero: numMatch };

  // (2) Loja
  const isComercialHint = /\b(loja|lojas|comercial|sala comercial)\b/.test(t);

  // (3) Tipologia
  const tipologia = extractTipologia(t);

  // (4) Filtros de preço ("até X", "entre X e Y", "no máximo X mil")
  const preco = extractFaixaPreco(t);

  if (tipologia || preco.min != null || preco.max != null || isComercialHint) {
    return {
      kind: "filtrar",
      tipologia,
      preco_min: preco.min,
      preco_max: preco.max,
      is_comercial: isComercialHint ? true : null,
    };
  }

  // (5) Pergunta aberta "quais tipologias / o que tem / opções"
  if (
    /\b(tipologias?|o que tem|quais opcoes|quais as opcoes|que opcoes|qual opcao|opcoes disponiveis)\b/.test(t)
  ) {
    return { kind: "listar_tipologias" };
  }

  // (6) Resumo / entrega / datas da obra — pergunta institucional mas
  //     que é melhor respondida pela tabela estruturada (entrega_prevista)
  //     do que por RAG vetorial. Usa resumo_tabela_precos pra trazer
  //     entrega + disclaimers oficiais (INCC, IGPM, etc).
  if (
    /\b(entrega|previsao de entrega|previsao|chaves|quando fica pronto|quando entrega|prazo da obra|resumo|visao geral|me conta sobre)\b/.test(
      t,
    )
  ) {
    return { kind: "resumo" };
  }

  return null;
}

function extractUnidadeNumero(raw: string): string | null {
  // Lojas: L01, L02 (com ou sem espaço)
  const loja = raw.match(/\b[lL]\s*0?\d{1,3}\b/);
  if (loja) return loja[0].toUpperCase().replace(/\s+/, "");

  // "unidade/apto/apt/ap <numero>"
  const prefixed = raw.match(/\b(?:unidade|apto|apt|ap)\.?\s*(\d{3,4})\b/i);
  if (prefixed) return prefixed[1];

  // Número 3-4 dígitos isolado. Aceita mesmo sem keyword ("e a 1812?",
  // "1811"). Filtragem é por FORMATO de unidade imobiliária:
  //   - 3-4 dígitos
  //   - faixa 101..3099 (andar 1..30, unidade 01..99)
  //   - não terminado em 00 (filtra "400", "2000" — preços/anos/ticks)
  //   - não no intervalo de anos prováveis (1900..2100)
  // É uma heurística; quando falha, a Bia pergunta (comportamento padrão
  // de "ambiguidade → clarify"). Fase B (tool_use nativo) resolve melhor.
  const loose = raw.match(/\b(\d{3,4})\b/);
  if (loose) {
    const n = Number(loose[1]);
    const isLikelyYear = n >= 1900 && n <= 2100;
    const isLikelyUnit =
      n >= 101 && n <= 3099 && n % 100 !== 0 && !isLikelyYear;
    if (isLikelyUnit) return loose[1];
  }
  return null;
}

function extractTipologia(normText: string): string | null {
  if (/\bstudios?\b|\bstd\b/.test(normText)) return "Studio";
  if (/\b1\s*q(uartos?)?\b|\b1qs?\b|\b1\s*dorm/.test(normText)) return "1Q";
  if (/\b2\s*q(uartos?)?\b|\b2qs?\b|\b2\s*dorm|dois quartos/.test(normText)) return "2Q";
  // Tipologias mais específicas ficam pro tool resolver por si só.
  return null;
}

function extractFaixaPreco(normText: string): { min: number | null; max: number | null } {
  // "ate/até 400 mil", "ate R$ 400.000"
  const ate = normText.match(/\bate\s+(r?\$?\s*)?([\d\.,]+)\s*(mil|milh|m)?\b/);
  const deAte = normText.match(/\bentre\s+([\d\.,]+)\s*(mil|milh|m)?\s*e\s+([\d\.,]+)\s*(mil|milh|m)?\b/);
  const menor = normText.match(/\b(menos|abaixo) de\s+([\d\.,]+)\s*(mil|milh|m)?\b/);

  let max: number | null = null;
  let min: number | null = null;
  if (deAte) {
    min = parseMoney(deAte[1], deAte[2]);
    max = parseMoney(deAte[3], deAte[4]);
  } else {
    if (ate) max = parseMoney(ate[2], ate[3]);
    if (menor) max = parseMoney(menor[2], menor[3]);
  }
  return { min, max };
}

function parseMoney(raw: string, unit: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (unit && /mil/.test(unit)) return n * 1000;
  if (unit && /milh|^m$/.test(unit)) return n * 1_000_000;
  // Sem unidade: se for pequeno (tipo "400"), assume "mil". 400 = R$ 400k.
  if (n < 10000) return n * 1000;
  return n;
}

// ─── renderização dos blocos ────────────────────────────────────────────────

const BRL = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function renderConsultarUnidadeBlock(
  nome: string,
  numero: string,
  r: Awaited<ReturnType<typeof consultarUnidade>>,
): string {
  if (!r.ok) {
    if (r.reason === "tabela_nao_cadastrada") {
      return [
        `TABELA_PRECOS_MATCH (empreendimento: ${nome}, numero: ${numero})`,
        `tabela_precos_disponivel=false`,
        `Responda ao lead que ainda não tem a tabela de preços carregada pra esse empreendimento e que vai confirmar o valor exato com o consultor humano.`,
      ].join("\n");
    }
    return `TABELA_PRECOS_MATCH: empreendimento "${nome}" não encontrado.`;
  }

  if (r.unidade_encontrada === false) {
    return [
      `TABELA_PRECOS_MATCH (empreendimento: ${r.empreendimento_nome}, numero: ${numero})`,
      `tabela_precos_disponivel=true`,
      `unidade_nao_encontrada=true`,
      `INSTRUÇÃO: Diga que a unidade ${numero} NÃO consta na tabela atual de ${r.empreendimento_nome}. Não invente, não sugira unidade parecida como se fosse a que o lead pediu.`,
    ].join("\n");
  }

  const u = r.unidade;
  const pp = u.plano_pagamento;
  const reforcos = pp?.reforcos ?? [];
  const linhas: string[] = [];
  linhas.push(`TABELA_PRECOS_MATCH (empreendimento: ${r.empreendimento_nome}, numero: ${u.numero})`);
  linhas.push(`tabela_precos_disponivel=true`);
  linhas.push(`unidade_encontrada=true`);
  linhas.push(`disponivel=${r.disponivel} (status=${u.status})`);
  linhas.push(`tipologia=${u.tipologia ?? "—"}`);
  if (u.andar != null) linhas.push(`andar=${u.andar}`);
  if (u.area_privativa != null) linhas.push(`area_privativa=${u.area_privativa} m²`);
  if (u.area_terraco != null && u.area_terraco > 0) linhas.push(`area_terraco=${u.area_terraco} m²`);
  linhas.push(`preco_total=${BRL(u.preco_total)}`);
  if (pp) {
    linhas.push(`sinal=${BRL(pp.sinal.valor)} em ${pp.sinal.parcelas}x`);
    linhas.push(`mensais=${BRL(pp.mensais.valor)} × ${pp.mensais.parcelas}`);
    if (reforcos.length) {
      linhas.push(
        `reforcos=${reforcos.length}× de ${BRL(reforcos[0]?.valor)} (${reforcos.map((r) => r.data).join(", ")})`,
      );
    }
    linhas.push(`saldo_final=${BRL(pp.saldo_final.valor)}${pp.saldo_final.data ? ` em ${pp.saldo_final.data}` : ""}`);
  }
  if (!r.disponivel) {
    linhas.push(`INSTRUÇÃO: A unidade existe mas está ${u.status} — diga isso claramente ao lead antes de citar valores, e ofereça alternativa.`);
  }
  linhas.push(`IMPORTANTE: copie os valores monetários EXATAMENTE como aparecem acima. Não arredonde. Não escreva "aprox.". Não troque vírgula por outra formatação.`);
  return linhas.join("\n");
}

function renderFiltrarBlock(
  nome: string,
  sub: Extract<QueryIntent, { kind: "filtrar" }>,
  r: Awaited<ReturnType<typeof filtrarUnidades>>,
): string {
  if (!r.ok) {
    if (r.reason === "tabela_nao_cadastrada") {
      return `TABELA_PRECOS_MATCH (${nome}): tabela_precos_disponivel=false. Diga ao lead que ainda não carregou a tabela e vai confirmar com consultor.`;
    }
    return `TABELA_PRECOS_MATCH: empreendimento "${nome}" não encontrado.`;
  }

  const filtros: string[] = [];
  if (sub.tipologia) filtros.push(`tipologia=${sub.tipologia}`);
  if (sub.preco_min != null) filtros.push(`preco_min=${BRL(sub.preco_min)}`);
  if (sub.preco_max != null) filtros.push(`preco_max=${BRL(sub.preco_max)}`);
  if (sub.is_comercial === true) filtros.push(`is_comercial=true`);

  const header = [
    `TABELA_PRECOS_MATCH (empreendimento: ${r.empreendimento_nome})`,
    `tabela_precos_disponivel=true`,
    `filtros: ${filtros.join(", ") || "—"}`,
    `count=${r.count}`,
  ].join("\n");

  if (r.count === 0) {
    return `${header}\nNenhuma unidade bate com esse filtro. Diga transparentemente pro lead.`;
  }

  const linhas = r.unidades.slice(0, 5).map((u) => {
    const pp = u.plano_pagamento;
    const mensal = pp ? `${BRL(pp.mensais.valor)} × ${pp.mensais.parcelas}` : "—";
    return `• ${u.numero} · ${u.tipologia ?? "—"} · ${u.area_privativa ?? "?"} m² · ${BRL(u.preco_total)} · sinal ${BRL(pp?.sinal.valor)} · mensal ${mensal}`;
  });
  const faixas = `Faixa encontrada: ${BRL(r.faixas.preco_min)} – ${BRL(r.faixas.preco_max)} · ${r.faixas.area_min ?? "?"}–${r.faixas.area_max ?? "?"} m²`;
  return [
    header,
    faixas,
    `unidades:`,
    ...linhas,
    r.count > 5 ? `(... e mais ${r.count - 5} unidades; mostre só 3 pro lead, perguntando se quer detalhes de alguma.)` : "",
    `IMPORTANTE: copie valores monetários EXATAMENTE como acima. Não arredonde. Não agrupe em "a partir de R$ Xk" — use os números literais.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderListarTipologiasBlock(
  nome: string,
  r: Awaited<ReturnType<typeof listarTipologias>>,
): string {
  if (!r.ok) {
    if (r.reason === "tabela_nao_cadastrada") {
      return `TABELA_PRECOS_MATCH (${nome}): tabela_precos_disponivel=false.`;
    }
    return `TABELA_PRECOS_MATCH: empreendimento "${nome}" não encontrado.`;
  }

  const linhas = r.tipologias.map((t) => {
    const preco = t.preco_a_partir != null ? `a partir de ${BRL(t.preco_a_partir)}` : "—";
    const area = t.area_min != null ? `${t.area_min}${t.area_max && t.area_max !== t.area_min ? `–${t.area_max}` : ""} m²` : "";
    return `• ${t.tipologia} (${t.is_comercial ? "comercial" : "residencial"}) · disponível ${t.disponivel}/${t.total} · ${preco}${area ? ` · ${area}` : ""}`;
  });
  return [
    `TABELA_PRECOS_MATCH (empreendimento: ${r.empreendimento_nome})`,
    `tabela_precos_disponivel=true`,
    `entrega_prevista=${r.entrega_prevista ?? "—"}`,
    `tipologias:`,
    ...linhas,
    `IMPORTANTE: copie valores monetários exatamente como acima.`,
  ].join("\n");
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function toBRDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
