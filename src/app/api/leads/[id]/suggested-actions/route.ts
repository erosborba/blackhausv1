import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropicUsage, logUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/[id]/suggested-actions
 *
 * HUD do /inbox/[id]: 3 ações sugeridas (drafts curtos) pro corretor copiar
 * e enviar ao lead. Diferente do copilot.ts (que é conversa via WhatsApp),
 * este endpoint é one-shot, stateless, otimizado pra latência baixa (<2s).
 *
 * Modelo: Haiku (barato + rápido). System prompt contém só o mínimo.
 * Resposta: { actions: [{ label, body, tone, confidence }], ... }
 *
 * Cacheia 30s em memória por lead pra não bater na IA a cada re-render.
 */

type SuggestedAction = {
  label: string;          // 2-4 palavras — aparece no pill do HUD
  body: string;           // mensagem completa que o corretor envia
  tone: "warm" | "direct" | "pragmatic";
  confidence: "alta" | "media" | "baixa";
};

type CacheEntry = {
  at: number;
  actions: SuggestedAction[];
};

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

const SYSTEM = `Você é a Bia SDR da Lumihaus. Com base no estado do lead e nas últimas mensagens, proponha 3 ações/respostas que o corretor pode disparar AGORA. Cada ação é um draft de mensagem curta (1-3 frases), pronta pra enviar pelo WhatsApp.

Regras:
- Foque no próximo passo concreto: qualificar campo faltante, marcar visita, responder objeção, pedir decisor, oferecer material.
- Tom humano, pt-BR, WhatsApp informal. Sem markdown pesado.
- Não invente preço, prazo, metragem, endereço.
- As 3 ações devem ser DISTINTAS entre si (não 3 variações do mesmo CTA).
- \`label\` é o pill (2-4 palavras, ex.: "Agendar visita", "Pedir decisor").
- \`tone\`: warm | direct | pragmatic.
- \`confidence\`: alta se tem contexto claro pro CTA; media/baixa se depende de assumir algo.

Devolva SOMENTE um JSON válido: { "actions": [ { label, body, tone, confidence }, ... ] }`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cache hit?
  const cached = CACHE.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, data: cached.actions, cached: true });
  }

  const sb = supabaseAdmin();
  const [leadRes, msgsRes] = await Promise.all([
    sb
      .from("leads")
      .select(
        "id, full_name, push_name, phone, status, stage, qualification, agent_notes, brief, memory, handoff_reason, handoff_urgency, score",
      )
      .eq("id", id)
      .maybeSingle(),
    sb
      .from("messages")
      .select("role, content, direction, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (leadRes.error) {
    return NextResponse.json({ ok: false, error: leadRes.error.message }, { status: 500 });
  }
  if (!leadRes.data) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }
  const lead = leadRes.data;
  const recent = (msgsRes.data ?? []).slice().reverse();

  const dialog = recent
    .map((m) => {
      const who =
        m.direction === "inbound"
          ? `${lead.push_name ?? lead.full_name ?? "Lead"}`
          : "Bia";
      return `${who}: ${m.content}`;
    })
    .join("\n");

  const userPrompt = `Lead: ${lead.full_name ?? lead.push_name ?? lead.phone}
Status: ${lead.status} · Stage: ${lead.stage ?? "—"} · Score: ${lead.score ?? 0}
Qualificação: ${JSON.stringify(lead.qualification ?? {})}
${lead.handoff_reason ? `Handoff: ${lead.handoff_reason} (${lead.handoff_urgency ?? "—"})\n` : ""}${lead.memory ? `Memória:\n${lead.memory}\n` : ""}${lead.agent_notes ? `Notas do corretor:\n${lead.agent_notes}\n` : ""}
Últimas mensagens:
${dialog || "(sem histórico)"}`;

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();

    const jsonText = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let parsed: { actions?: SuggestedAction[] } = {};
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = { actions: [] };
    }
    const actions = (parsed.actions ?? []).slice(0, 3).filter((a) => a.label && a.body);

    logUsage({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      task: "suggested_actions",
      ...anthropicUsage(resp),
      durationMs: Date.now() - t0,
      leadId: id,
      ok: true,
    });

    CACHE.set(id, { at: Date.now(), actions });
    return NextResponse.json({ ok: true, data: actions });
  } catch (e) {
    logUsage({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      task: "suggested_actions",
      durationMs: Date.now() - t0,
      leadId: id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ai_failed" },
      { status: 500 },
    );
  }
}
