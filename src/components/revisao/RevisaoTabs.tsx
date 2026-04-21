"use client";

import { useState } from "react";
import Link from "next/link";
import type { DraftConfidence } from "@/lib/drafts";
import { approvalPct, type DraftWithRefs, type RevisaoStats } from "./types";

type TabKey = "overview" | "pendentes" | "aprendizado";

/**
 * Container client-side que abriga as 3 abas. A opção por client component
 * é prática: a aba "Pendentes" precisa de estado local (textarea + submit
 * otimista) e a "Overview" é só render, o custo é baixo.
 */
export function RevisaoTabs({
  tab,
  drafts,
  stats,
  canApprove,
}: {
  tab: TabKey;
  drafts: DraftWithRefs[];
  stats: RevisaoStats;
  canApprove: boolean;
}) {
  if (tab === "pendentes") {
    return <PendentesTab drafts={drafts} canApprove={canApprove} />;
  }
  if (tab === "aprendizado") return <AprendizadoTab />;
  return <OverviewTab drafts={drafts} stats={stats} />;
}

// ── Overview ──────────────────────────────────────────────────────────

function OverviewTab({
  drafts,
  stats,
}: {
  drafts: DraftWithRefs[];
  stats: RevisaoStats;
}) {
  const overall = approvalPct(stats);
  const alta = approvalPct(stats.byConfidence.alta);
  const media = approvalPct(stats.byConfidence.media);
  const baixa = approvalPct(stats.byConfidence.baixa);

  return (
    <div className="revisao-body">
      <div className="rev-cards">
        <StatCard
          label="Total propostas"
          value={stats.total}
          hint={`${stats.approved} aprovados · ${stats.edited} editados · ${stats.proposed} pendentes`}
        />
        <StatCard
          label="Aprovação geral"
          value={overall == null ? "—" : `${overall}%`}
          hint="sem nenhuma edição do corretor"
        />
        <StatCard
          label="🟢 Alta"
          value={alta == null ? "—" : `${alta}%`}
          hint={`${stats.byConfidence.alta.approved}/${stats.byConfidence.alta.total} aprovadas${
            alta != null && alta >= 90 ? " · pronta pra auto-send" : ""
          }`}
          tone={alta != null && alta >= 90 ? "ok" : undefined}
        />
        <StatCard
          label="🟡 Média"
          value={media == null ? "—" : `${media}%`}
          hint={`${stats.byConfidence.media.approved}/${stats.byConfidence.media.total} aprovadas`}
        />
      </div>

      <section className="rev-section">
        <h2 className="rev-section-title">Breakdown por confiança</h2>
        <div className="rev-table">
          <div className="rev-tr rev-tr-head">
            <div>Confiança</div>
            <div className="num">Total</div>
            <div className="num">Aprovadas</div>
            <div className="num">Editadas</div>
            <div className="num">Pendentes</div>
            <div className="num">Taxa</div>
          </div>
          {(["alta", "media", "baixa"] as DraftConfidence[]).map((c) => {
            const b = stats.byConfidence[c];
            const pct = approvalPct(b);
            return (
              <div key={c} className="rev-tr">
                <div>
                  <span className={`conf-chip conf-${c}`}>{c}</span>
                </div>
                <div className="num">{b.total}</div>
                <div className="num num-approved">{b.approved}</div>
                <div className="num num-edited">{b.edited}</div>
                <div className="num num-pending">{b.proposed}</div>
                <div className="num num-pct">{pct == null ? "—" : `${pct}%`}</div>
              </div>
            );
          })}
        </div>
        <p className="rev-note">
          Alvo pra ligar auto-send do bucket <strong>alta</strong>: ≥ 95%.{" "}
          {baixa != null && baixa < 50
            ? "Bucket baixa precisa de curadoria — considere ajustar thresholds em /ajustes."
            : ""}
        </p>
      </section>

      <section className="rev-section">
        <h2 className="rev-section-title">Últimas propostas</h2>
        {drafts.length === 0 ? (
          <div className="rev-empty">Nenhum draft no período.</div>
        ) : (
          <ul className="rev-feed">
            {drafts.slice(0, 20).map((d) => (
              <DraftFeedRow key={d.id} d={d} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Pendentes (approve/edit inline) ───────────────────────────────────

function PendentesTab({
  drafts,
  canApprove,
}: {
  drafts: DraftWithRefs[];
  canApprove: boolean;
}) {
  const pending = drafts.filter((d) => d.action === "proposed");

  if (pending.length === 0) {
    return (
      <div className="revisao-body">
        <div className="rev-empty rev-empty-big">
          <div className="rev-empty-title">Nada na fila 🎯</div>
          <div className="rev-empty-sub">
            Todas as propostas recentes da Bia já foram aprovadas, editadas ou ignoradas.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="revisao-body">
      <p className="rev-hint">
        {pending.length} draft(s) aguardando revisão.{" "}
        {canApprove
          ? "Aprove (envia o texto como está) ou edite antes de enviar."
          : "Somente admins podem aprovar — você vê o conteúdo mas não tem ação."}
      </p>
      <ul className="rev-pending">
        {pending.map((d) => (
          <PendenteCard key={d.id} d={d} canApprove={canApprove} />
        ))}
      </ul>
    </div>
  );
}

function PendenteCard({
  d,
  canApprove,
}: {
  d: DraftWithRefs;
  canApprove: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.proposed_text);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [finalAction, setFinalAction] = useState<"approved" | "edited" | "ignored" | null>(
    null,
  );

  const leadName = d.leads?.full_name || d.leads?.push_name || d.leads?.phone || "—";

  async function act(action: "approved" | "edited" | "ignored") {
    if (!canApprove) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/admin/drafts/${d.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          final_text: action === "ignored" ? null : text,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "falha");
      setStatus("done");
      setFinalAction(action);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "erro");
    }
  }

  if (status === "done" && finalAction) {
    return (
      <li className="pend-card pend-done">
        <span className={`action-chip action-${finalAction}`}>{finalAction}</span>
        <span className="pend-lead">{leadName}</span>
        <span className="pend-done-msg">registrado.</span>
      </li>
    );
  }

  return (
    <li className="pend-card">
      <div className="pend-meta">
        <span className={`conf-chip conf-${d.confidence}`}>{d.confidence}</span>
        <Link href={`/leads/${d.lead_id}`} className="pend-lead-link">
          {leadName}
        </Link>
        {d.agents?.name ? <span className="pend-agent">· {d.agents.name}</span> : null}
        <span className="pend-when">{timeAgo(d.created_at)}</span>
      </div>

      {editing ? (
        <textarea
          className="pend-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
        />
      ) : (
        <div className="pend-text">{d.proposed_text}</div>
      )}

      {canApprove ? (
        <div className="pend-actions">
          {!editing ? (
            <>
              <button
                type="button"
                className="btn-approve"
                onClick={() => act("approved")}
                disabled={status === "saving"}
              >
                ✓ Aprovar
              </button>
              <button
                type="button"
                className="btn-edit"
                onClick={() => setEditing(true)}
                disabled={status === "saving"}
              >
                ✎ Editar
              </button>
              <button
                type="button"
                className="btn-ignore"
                onClick={() => act("ignored")}
                disabled={status === "saving"}
              >
                Ignorar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-approve"
                onClick={() => act("edited")}
                disabled={status === "saving" || text === d.proposed_text}
              >
                Salvar edição
              </button>
              <button
                type="button"
                className="btn-ignore"
                onClick={() => {
                  setEditing(false);
                  setText(d.proposed_text);
                }}
                disabled={status === "saving"}
              >
                Cancelar
              </button>
            </>
          )}
          {status === "saving" ? <span className="pend-saving">salvando…</span> : null}
          {error ? <span className="pend-error">erro: {error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

// ── Aprendizado (placeholder) ─────────────────────────────────────────

function AprendizadoTab() {
  return (
    <div className="revisao-body">
      <div className="rev-empty rev-empty-big">
        <div className="rev-empty-title">Aprendizado ainda não disponível</div>
        <div className="rev-empty-sub">
          A tabela <code>draft_learnings</code> (padrões extraídos das edições
          do corretor pra refinar prompts) entra na Phase 5. Por enquanto, use
          a aba Overview pra medir taxa de aprovação e a aba Pendentes pra
          revisar drafts em aberto.
        </div>
      </div>
    </div>
  );
}

// ── Bits compartilhados ───────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={`rev-stat ${tone ? `tone-${tone}` : ""}`}>
      <div className="rev-stat-label">{label}</div>
      <div className="rev-stat-value">{value}</div>
      {hint ? <div className="rev-stat-hint">{hint}</div> : null}
    </div>
  );
}

function DraftFeedRow({ d }: { d: DraftWithRefs }) {
  const leadName = d.leads?.full_name || d.leads?.push_name || d.leads?.phone || "—";
  const wasEdited =
    d.action === "edited" && d.final_text && d.final_text !== d.proposed_text;

  return (
    <li className="feed-row">
      <div className="feed-meta">
        <span className={`action-chip action-${d.action}`}>{d.action}</span>
        <span className={`conf-chip conf-${d.confidence}`}>{d.confidence}</span>
        <Link href={`/leads/${d.lead_id}`} className="feed-lead">
          {leadName}
        </Link>
        {d.agents?.name ? <span className="feed-agent">· {d.agents.name}</span> : null}
        <span className="feed-when">{timeAgo(d.created_at)}</span>
      </div>
      <div className="feed-text">{d.proposed_text}</div>
      {wasEdited ? (
        <div className="feed-edited">
          <div className="feed-edited-label">Editado pelo corretor:</div>
          {d.final_text}
        </div>
      ) : null}
    </li>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
