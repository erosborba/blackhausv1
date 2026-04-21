"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads";
import type { ThreadMessage } from "@/components/inbox/types";
import type { DraftRow } from "@/lib/drafts";
import {
  HANDOFF_RATINGS,
  HANDOFF_RATING_LABEL,
  HANDOFF_RATING_HINT,
  HANDOFF_RATING_EMOJI,
  type HandoffRating,
  type HandoffFeedbackRow,
} from "@/lib/handoff-feedback";
import {
  HANDOFF_REASON_LABEL,
  HANDOFF_URGENCY_EMOJI,
} from "@/lib/handoff-copy";
import { Bubble } from "@/components/inbox/Bubble";
import { Chip } from "@/components/ui/Chip";

type Emp = { id: string; nome: string; slug: string | null };

/**
 * Handoff review client — duas colunas:
 *   Esquerda: thread compacta + diff rascunho (proposed vs final).
 *   Direita: decision radio + note + opcional FAQ promoter + commit bar.
 *
 * Commit envia POST /api/handoff/[leadId]; após sucesso, volta pro /inbox
 * (ou mantém a página com banner de confirmação se o corretor quiser
 * re-avaliar).
 */
export function HandoffReview({
  lead,
  messages,
  draft,
  empreendimentos,
  latestFeedback,
  feedbackHistory,
}: {
  lead: Lead;
  messages: ThreadMessage[];
  draft: DraftRow | null;
  empreendimentos: Emp[];
  latestFeedback: HandoffFeedbackRow | null;
  feedbackHistory: HandoffFeedbackRow[];
}) {
  const router = useRouter();
  const name = lead.full_name ?? lead.push_name ?? lead.phone;

  const [rating, setRating] = useState<HandoffRating | null>(
    latestFeedback?.rating ?? null,
  );
  const [note, setNote] = useState(latestFeedback?.note ?? "");
  const [addFaq, setAddFaq] = useState(false);
  const [empId, setEmpId] = useState<string>(empreendimentos[0]?.id ?? "");
  const [faqQ, setFaqQ] = useState(seedFaqQuestion(messages));
  const [faqA, setFaqA] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Diff rascunho: proposed_text vs final_text (se editado).
  const diffLines = useMemo(() => buildDiff(draft), [draft]);

  async function submit() {
    if (!rating) {
      setErr("Escolha uma avaliação.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    setOk(null);
    try {
      const body: Record<string, unknown> = { rating };
      if (note.trim()) body.note = note.trim();
      if (addFaq && empId && faqQ.trim().length >= 3 && faqA.trim().length >= 3) {
        body.addToFaq = {
          empreendimentoId: empId,
          question: faqQ.trim(),
          answer: faqA.trim(),
        };
      }
      const res = await fetch(`/api/handoff/${lead.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.formErrors?.[0] ?? "erro");
      setOk(
        json.data?.faqIndexed !== null && json.data?.faqIndexed !== undefined
          ? `Feedback salvo. ${json.data.faqIndexed} chunks re-indexados no FAQ.`
          : "Feedback salvo.",
      );
      // Delay pro corretor ver o banner, depois volta pro inbox.
      setTimeout(() => router.push(`/inbox/${lead.id}`), 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  }

  const reasonLabel = lead.handoff_reason
    ? HANDOFF_REASON_LABEL[lead.handoff_reason]
    : "—";
  const urgencyEmoji = lead.handoff_urgency
    ? HANDOFF_URGENCY_EMOJI[lead.handoff_urgency]
    : "—";

  return (
    <div className="handoff-grid">
      <section className="handoff-thread">
        <header className="handoff-head">
          <div>
            <div className="handoff-title">{name}</div>
            <div className="handoff-sub">
              {lead.phone}
              {lead.stage ? ` · ${lead.stage}` : ""}
              {typeof lead.score === "number" ? ` · score ${lead.score}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Chip tone={urgencyTone(lead.handoff_urgency)}>
              {urgencyEmoji} {reasonLabel}
            </Chip>
          </div>
        </header>

        <div className="handoff-context">
          <div className="section-label">Contexto (últimas 30 msgs)</div>
          <div className="handoff-msgs">
            {messages.length === 0 ? (
              <div className="muted">Sem mensagens.</div>
            ) : (
              messages.map((m) => <Bubble key={m.id} m={m} />)
            )}
          </div>
        </div>

        {draft ? (
          <div className="handoff-draft">
            <div className="section-label">
              Rascunho da Bia · confidence {draft.confidence} · {draft.action}
            </div>
            {diffLines ? (
              <pre className="diff-view">{diffLines}</pre>
            ) : (
              <pre className="diff-view solo">{draft.proposed_text}</pre>
            )}
            <div className="draft-meta">
              {new Date(draft.created_at).toLocaleString("pt-BR")}
            </div>
          </div>
        ) : (
          <div className="handoff-draft empty">
            <div className="section-label">Rascunho</div>
            <div className="muted">
              Sem rascunho proposto pra este lead — Bia escalou sem preparar
              resposta.
            </div>
          </div>
        )}
      </section>

      <aside className="handoff-panel">
        <div className="panel-card">
          <h2 className="panel-h">Avaliar handoff</h2>
          <p className="panel-sub">
            Isso retroalimenta o router pra escalar melhor no futuro.
          </p>
          <div className="rating-group">
            {HANDOFF_RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                className={`rating ${rating === r ? "on" : ""}`}
                onClick={() => setRating(r)}
              >
                <span className="emoji">{HANDOFF_RATING_EMOJI[r]}</span>
                <span className="label">{HANDOFF_RATING_LABEL[r]}</span>
                <span className="hint">{HANDOFF_RATING_HINT[r]}</span>
              </button>
            ))}
          </div>

          <label className="panel-field">
            <span>Nota (opcional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: lead já tinha financiamento aprovado, faltava só agendar"
              rows={3}
              maxLength={500}
            />
          </label>

          <label className="panel-toggle">
            <input
              type="checkbox"
              checked={addFaq}
              onChange={(e) => setAddFaq(e.target.checked)}
            />
            <span>Promover Q&A pro FAQ do empreendimento</span>
          </label>

          {addFaq ? (
            <div className="faq-block">
              <label className="panel-field">
                <span>Empreendimento</span>
                <select value={empId} onChange={(e) => setEmpId(e.target.value)}>
                  {empreendimentos.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="panel-field">
                <span>Pergunta</span>
                <input
                  value={faqQ}
                  onChange={(e) => setFaqQ(e.target.value)}
                  placeholder="Pergunta do lead"
                  maxLength={500}
                />
              </label>
              <label className="panel-field">
                <span>Resposta canônica</span>
                <textarea
                  value={faqA}
                  onChange={(e) => setFaqA(e.target.value)}
                  placeholder="A resposta que a Bia deveria ter dado"
                  rows={4}
                  maxLength={2000}
                />
              </label>
              <div className="faq-hint">
                Salvar re-indexa o empreendimento; Bia passa a usar essa
                resposta nas próximas conversas.
              </div>
            </div>
          ) : null}

          {err ? <div className="panel-err">{err}</div> : null}
          {ok ? <div className="panel-ok">{ok}</div> : null}

          <div className="commit-bar">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => router.push(`/inbox/${lead.id}`)}
              disabled={submitting}
            >
              Voltar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={submitting || !rating}
            >
              {submitting ? "Salvando…" : "Salvar avaliação"}
            </button>
          </div>
        </div>

        {feedbackHistory.length > 0 ? (
          <div className="panel-card">
            <h3 className="panel-h">Histórico</h3>
            <div className="history-list">
              {feedbackHistory.map((f) => (
                <div key={f.id} className="history-row">
                  <span className="history-when">
                    {new Date(f.at).toLocaleString("pt-BR")}
                  </span>
                  <span className="history-rating">
                    {HANDOFF_RATING_EMOJI[f.rating]}{" "}
                    {HANDOFF_RATING_LABEL[f.rating]}
                  </span>
                  {f.actor ? (
                    <span className="history-actor">{f.actor}</span>
                  ) : null}
                  {f.note ? <span className="history-note">{f.note}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function urgencyTone(u: Lead["handoff_urgency"]): "hot" | "warm" | "cool" | "ok" {
  if (u === "alta") return "hot";
  if (u === "media") return "warm";
  if (u === "baixa") return "cool";
  return "ok";
}

/**
 * Se o draft foi editado/aprovado, mostra proposed → final no formato
 * "- linha removida / + linha adicionada". Se não editado, retorna null
 * (caller mostra só proposed_text direto).
 */
function buildDiff(draft: DraftRow | null): string | null {
  if (!draft) return null;
  if (draft.action !== "edited" || !draft.final_text) return null;
  const a = draft.proposed_text.split(/\r?\n/);
  const b = draft.final_text.split(/\r?\n/);
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const la = a[i];
    const lb = b[i];
    if (la === lb) {
      out.push(`  ${la ?? ""}`);
    } else {
      if (la !== undefined) out.push(`- ${la}`);
      if (lb !== undefined) out.push(`+ ${lb}`);
    }
  }
  return out.join("\n");
}

/**
 * Heurística pra preencher a pergunta do FAQ: pega a última mensagem
 * inbound (do lead) que pareça uma pergunta — contém "?" ou começa com
 * interrogativo. Fallback pra string vazia.
 */
function seedFaqQuestion(messages: ThreadMessage[]): string {
  const inbound = messages.filter((m) => m.direction === "inbound").reverse();
  const hit = inbound.find((m) => /\?|^(quanto|quando|qual|como|onde|tem|posso|quais|quantos)/i.test(m.content.trim()));
  return hit ? hit.content.slice(0, 280) : "";
}
