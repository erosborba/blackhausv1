import { supabaseAdmin } from "@/lib/supabase";
import {
  consultarUnidade,
  filtrarUnidades,
  filtrarUnidadesMulti,
  listarTipologias,
  resumoTabelaPrecos,
} from "./tools";
import type { RetrievedSource } from "./retrieval";
import {
  classifyQueryIntent as _classifyQueryIntent,
  norm,
  type QueryIntent,
} from "./tabela-precos-classifier";

// Re-export pra calls antigos (e pro teste unitário) seguirem importando
// daqui. A implementação vive em `tabela-precos-classifier.ts` (puro).
export const classifyQueryIntent = _classifyQueryIntent;

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

  // 1. Resolve empreendimento (pode ser null = lead não citou nem temos
  //    pista forte na memória; aí tentamos modo multi-emp pra filtrar).
  const emp = await pickEmpreendimento(text, input.retrievedSources, input.leadMemory);

  // 2. Classifica sub-intent
  const sub = classifyQueryIntent(text);
  if (!sub) return null;

  // 2b. Sem empreendimento alvo: só faz sentido continuar pra "filtrar"
  //     (tipologia/preço varre os ativos). Outros sub-intents precisam de
  //     alvo (número, listar, resumo) — sem alvo, devolve null e a Bia
  //     pergunta qual prédio o lead quer.
  if (!emp) {
    if (sub.kind !== "filtrar") return null;
    const r = await filtrarUnidadesMulti({
      tipologia: sub.tipologia ?? null,
      preco_max: sub.preco_max ?? null,
      preco_min: sub.preco_min ?? null,
      is_comercial: sub.is_comercial ?? null,
      apenas_disponiveis: true,
      limit_per_emp: 3,
      limit_total: 12,
    });
    return renderFiltrarMultiBlock(sub, r);
  }

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

function renderFiltrarMultiBlock(
  sub: Extract<QueryIntent, { kind: "filtrar" }>,
  r: Awaited<ReturnType<typeof filtrarUnidadesMulti>>,
): string {
  if (!r.ok) {
    return `TABELA_PRECOS_MATCH (multi): nenhum empreendimento ativo. Diga ao lead que vai confirmar com o consultor.`;
  }

  const filtros: string[] = [];
  if (sub.tipologia) filtros.push(`tipologia=${sub.tipologia}`);
  if (sub.preco_min != null) filtros.push(`preco_min=${BRL(sub.preco_min)}`);
  if (sub.preco_max != null) filtros.push(`preco_max=${BRL(sub.preco_max)}`);
  if (sub.is_comercial === true) filtros.push(`is_comercial=true`);

  const header = [
    `TABELA_PRECOS_MATCH (escopo: TODOS os empreendimentos ativos)`,
    `filtros: ${filtros.join(", ") || "—"}`,
    `count_total=${r.count} · empreendimentos_com_match=${r.empreendimentos_com_match}`,
  ].join("\n");

  if (r.count === 0) {
    return [
      header,
      `Nenhuma unidade bate com esse filtro em nenhum dos empreendimentos ativos.`,
      `INSTRUÇÃO: Diga isso de forma transparente — "olhei aqui e não temos opção nessa faixa hoje" — e pergunte se ele topa flexibilizar (faixa, tipologia, bairro). NÃO prometa "vou perguntar pro consultor"; a tabela é a fonte da verdade.`,
    ].join("\n");
  }

  // Agrupa por empreendimento pra Bia poder mencionar opções de cada prédio.
  const porEmp = new Map<string, typeof r.unidades>();
  for (const u of r.unidades) {
    const key = u.empreendimento_id;
    if (!porEmp.has(key)) porEmp.set(key, []);
    porEmp.get(key)!.push(u);
  }

  const blocos: string[] = [];
  for (const [, unidades] of porEmp) {
    const nome = unidades[0]?.empreendimento_nome ?? "—";
    blocos.push(`\n${nome}:`);
    for (const u of unidades.slice(0, 3)) {
      const pp = u.plano_pagamento;
      const mensal = pp ? `${BRL(pp.mensais.valor)} × ${pp.mensais.parcelas}` : "—";
      blocos.push(
        `  • ${u.numero} · ${u.tipologia ?? "—"} · ${u.area_privativa ?? "?"} m² · ${BRL(u.preco_total)} · sinal ${BRL(pp?.sinal.valor)} · mensal ${mensal}`,
      );
    }
  }

  const faixas = `Faixa global: ${BRL(r.faixas.preco_min)} – ${BRL(r.faixas.preco_max)} · ${r.faixas.area_min ?? "?"}–${r.faixas.area_max ?? "?"} m²`;

  return [
    header,
    faixas,
    `unidades_por_empreendimento:`,
    ...blocos,
    `IMPORTANTE: copie valores monetários EXATAMENTE como acima. Mostre no máximo 2 empreendimentos pro lead (escolha os com unidade mais barata) com 1-2 opções de cada. Pergunte qual interessa pra detalhar mais. NÃO diga "vou perguntar pro consultor" — você JÁ tem os dados.`,
  ].join("\n");
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

function toBRDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
