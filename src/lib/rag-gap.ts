import { supabaseAdmin } from "./supabase";

/**
 * RAG gap report — Track 1 · Slice 1.5.
 *
 * Fecha o loop: corretor avalia "Bia segurou demais" (rating `tarde`) →
 * cruzamos com empreendimentos que a Bia CITOU nas últimas mensagens →
 * gap score alto = a Bia ficou segurando em cima de um empreendimento
 * pobre de dados, ou de um que ela nem tinha, só achava que tinha.
 *
 * Isso vira input pra: (a) priorizar re-indexação de FAQs do empreendimento
 * em questão; (b) decidir se a Bia deveria ter escalado mais cedo.
 *
 * Invariants: I-3 (usa índices existentes); I-7 (audit-based — cruza
 * handoff_feedback + messages.sources, ambos fontes canônicas).
 */

type MessageWithSources = {
  id: string;
  lead_id: string;
  content: string;
  created_at: string;
  sources: unknown[] | null;
};

export type GapEntry = {
  empreendimentoId: string;
  nome: string | null;
  slug: string | null;
  /** Quantas vezes citado em mensagens antes de handoff com rating 'tarde'. */
  citedTardeCount: number;
  /** Quantas vezes citado antes de handoff com rating 'bom'. */
  citedBomCount: number;
  /** Total de feedbacks distintos associados. */
  feedbackCount: number;
  /**
   * Gap score: quanto mais `tarde` sobre `bom`, maior.
   *   score = (tarde - bom) + tarde * 0.5
   * — tarde puxa positivo, bom puxa negativo.
   */
  gapScore: number;
  /** Último leadId onde isso aconteceu (pra drilldown). */
  lastLeadId: string;
  lastAt: string;
};

export type GapReport = {
  sinceDays: number;
  totalHandoffsAnalyzed: number;
  entries: GapEntry[];
};

export async function fetchRagGapReport(sinceDays = 30): Promise<GapReport> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. Feedbacks "bom" ou "tarde" na janela. "cedo" e "lead_ruim" não
  //    indicam gap de RAG (cedo = ia_incerta demais; lead_ruim = sem fit).
  const { data: feedbacks, error: fbErr } = await sb
    .from("handoff_feedback")
    .select("id, lead_id, rating, at")
    .in("rating", ["tarde", "bom"])
    .gte("at", since)
    .order("at", { ascending: false });
  if (fbErr) throw new Error(`handoff_feedback: ${fbErr.message}`);

  const feedbackList = (feedbacks ?? []) as Array<{
    id: string;
    lead_id: string;
    rating: "tarde" | "bom";
    at: string;
  }>;

  if (feedbackList.length === 0) {
    return { sinceDays, totalHandoffsAnalyzed: 0, entries: [] };
  }

  // 2. Pra cada lead, últimas 10 mensagens antes do handoff.
  //    Buscamos em lote: todas as mensagens dos leads envolvidos, depois
  //    filtramos no código — evita N+1 round-trips.
  const leadIds = [...new Set(feedbackList.map((f) => f.lead_id))];
  const { data: msgs, error: msgErr } = await sb
    .from("messages")
    .select("id, lead_id, content, created_at, sources")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false })
    .limit(leadIds.length * 40); // buffer razoável pra pegar pré-handoff
  if (msgErr) throw new Error(`messages: ${msgErr.message}`);

  const messagesByLead = new Map<string, MessageWithSources[]>();
  for (const m of (msgs ?? []) as MessageWithSources[]) {
    const arr = messagesByLead.get(m.lead_id) ?? [];
    arr.push(m);
    messagesByLead.set(m.lead_id, arr);
  }

  // 3. Agrega citações por empreendimento, ponderado por rating.
  type Accum = {
    empreendimentoId: string;
    nome: string | null;
    slug: string | null;
    citedTardeCount: number;
    citedBomCount: number;
    feedbackIds: Set<string>;
    lastLeadId: string;
    lastAt: string;
  };
  const byEmp = new Map<string, Accum>();

  for (const fb of feedbackList) {
    const leadMsgs = messagesByLead.get(fb.lead_id) ?? [];
    // Pega só mensagens até 10 antes do feedback (que foi dado após handoff).
    const before = leadMsgs
      .filter((m) => m.created_at <= fb.at)
      .slice(0, 10);

    for (const msg of before) {
      const srcs = Array.isArray(msg.sources) ? msg.sources : [];
      for (const s of srcs) {
        if (!s || typeof s !== "object") continue;
        const rec = s as {
          empreendimentoId?: string;
          nome?: string;
          slug?: string | null;
        };
        const id = rec.empreendimentoId;
        if (!id) continue;

        const acc = byEmp.get(id) ?? {
          empreendimentoId: id,
          nome: rec.nome ?? null,
          slug: rec.slug ?? null,
          citedTardeCount: 0,
          citedBomCount: 0,
          feedbackIds: new Set<string>(),
          lastLeadId: fb.lead_id,
          lastAt: fb.at,
        };

        // Conta 1x por feedback (mesmo que apareça em várias msgs do lead).
        if (!acc.feedbackIds.has(fb.id)) {
          acc.feedbackIds.add(fb.id);
          if (fb.rating === "tarde") acc.citedTardeCount++;
          else acc.citedBomCount++;

          if (fb.at > acc.lastAt) {
            acc.lastAt = fb.at;
            acc.lastLeadId = fb.lead_id;
          }
        }
        byEmp.set(id, acc);
      }
    }
  }

  // 4. Calcula gap score e ordena.
  const entries: GapEntry[] = [...byEmp.values()]
    .map((a) => ({
      empreendimentoId: a.empreendimentoId,
      nome: a.nome,
      slug: a.slug,
      citedTardeCount: a.citedTardeCount,
      citedBomCount: a.citedBomCount,
      feedbackCount: a.feedbackIds.size,
      gapScore: a.citedTardeCount - a.citedBomCount + a.citedTardeCount * 0.5,
      lastLeadId: a.lastLeadId,
      lastAt: a.lastAt,
    }))
    .sort((a, b) => b.gapScore - a.gapScore);

  return {
    sinceDays,
    totalHandoffsAnalyzed: feedbackList.length,
    entries: entries.slice(0, 50),
  };
}
