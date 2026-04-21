import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { getCurrentRole } from "@/lib/auth/role-server";
import {
  HANDOFF_RATINGS,
  getLatestFeedback,
  listFeedback,
  recordHandoffFeedback,
  type HandoffRating,
} from "@/lib/handoff-feedback";
import { emitLeadEvent } from "@/lib/lead-events";
import { reindexEmpreendimento } from "@/lib/empreendimentos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ leadId: string }> };

/**
 * GET /api/handoff/[leadId]
 *
 * Pacote completo pra /handoff/[leadId]:
 *   - lead (com reason/urgency/score)
 *   - últimas 30 mensagens (pra corretor ler contexto da escalação)
 *   - draft proposto mais recente (se houver) — diff rascunho
 *   - feedback history do lead
 *   - último feedback (pra pre-selecionar radio)
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leadId } = await ctx.params;
  const sb = supabaseAdmin();

  const [leadRes, msgsRes, draftRes, latestFb, fbHistory] = await Promise.all([
    sb.from("leads").select("*").eq("id", leadId).maybeSingle(),
    sb
      .from("messages")
      .select("id, role, direction, content, created_at, sources")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(30),
    sb
      .from("drafts")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getLatestFeedback(leadId),
    listFeedback(leadId),
  ]);

  if (leadRes.error) {
    return NextResponse.json({ ok: false, error: leadRes.error.message }, { status: 500 });
  }
  if (!leadRes.data) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const messages = (msgsRes.data ?? []).slice().reverse();
  return NextResponse.json({
    ok: true,
    data: {
      lead: leadRes.data,
      messages,
      draft: draftRes.data ?? null,
      latestFeedback: latestFb,
      feedbackHistory: fbHistory,
    },
  });
}

// ── POST ──────────────────────────────────────────────────────────────────

const postSchema = z.object({
  rating: z.enum(HANDOFF_RATINGS as [HandoffRating, ...HandoffRating[]]),
  note: z.string().trim().max(500).optional().nullable(),
  addToFaq: z
    .object({
      empreendimentoId: z.string().uuid(),
      question: z.string().trim().min(3).max(500),
      answer: z.string().trim().min(3).max(2000),
    })
    .optional(),
});

/**
 * POST /api/handoff/[leadId]
 *
 * Grava o feedback do corretor/gestor sobre o handoff. Opcional: promover
 * Q&A pro FAQ do empreendimento (endpoint real — re-indexa o RAG).
 *
 * Emite lead_event `handoff_feedback` pra aparecer na timeline do /inbox/[id].
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { leadId } = await ctx.params;
  const role = await getCurrentRole();
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { rating, note, addToFaq } = parsed.data;

  // 1. Grava feedback.
  const fb = await recordHandoffFeedback({
    leadId,
    rating,
    note: note ?? null,
    actor: role === "admin" ? "gestor" : "corretor",
  });
  if (!fb) {
    return NextResponse.json(
      { ok: false, error: "feedback_insert_failed" },
      { status: 500 },
    );
  }

  // 2. Promove Q&A pro FAQ (opcional).
  let faqIndexed: number | null = null;
  let faqError: string | null = null;
  if (addToFaq) {
    const sb = supabaseAdmin();
    const { error: faqErr } = await sb.from("empreendimento_faqs").insert({
      empreendimento_id: addToFaq.empreendimentoId,
      question: addToFaq.question,
      answer: addToFaq.answer,
      source: "manual",
    });
    if (faqErr) {
      faqError = faqErr.message;
    } else {
      try {
        faqIndexed = await reindexEmpreendimento(addToFaq.empreendimentoId);
      } catch (e) {
        faqError = e instanceof Error ? e.message : "reindex_failed";
      }
    }
  }

  // 3. Timeline event.
  emitLeadEvent({
    leadId,
    kind: "handoff_feedback",
    payload: {
      rating,
      note: note ?? null,
      added_to_faq: addToFaq ? addToFaq.empreendimentoId : null,
    },
    actor: role === "admin" ? "gestor" : "corretor",
  });

  return NextResponse.json({
    ok: true,
    data: { feedback: fb, faqIndexed, faqError },
  });
}
