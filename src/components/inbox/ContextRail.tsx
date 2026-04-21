"use client";

import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { Timeline } from "./Timeline";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Chip } from "@/components/ui/Chip";
import { HANDOFF_REASON_LABEL, HANDOFF_URGENCY_EMOJI } from "@/lib/handoff-copy";

/**
 * Coluna direita do /inbox/[id] — contexto estático do lead + qualificação
 * + timeline (eventos do `lead_events`). É o "painel do corretor".
 */
export function ContextRail({ lead }: { lead: Lead }) {
  const q = (lead.qualification ?? {}) as Record<string, unknown>;
  const score = lead.score ?? 0;

  return (
    <aside className="inbox-context">
      {/* Score + status */}
      <section className="ctx-section" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <ScoreRing value={score} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Score
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2 }}>
            {score}
            <span style={{ fontSize: 12, color: "var(--ink-4)", marginLeft: 6 }}>/100</span>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            <Chip tone="default">{lead.status}</Chip>
            {lead.stage ? <Chip tone="ghost">{lead.stage}</Chip> : null}
          </div>
        </div>
      </section>

      {/* Handoff ativo — pendente (não revisado) */}
      {lead.handoff_notified_at && !lead.bridge_active ? (
        <section className="ctx-section">
          <h3>Handoff pendente</h3>
          <div style={{ fontSize: 13, color: "var(--ink)" }}>
            {lead.handoff_urgency ? HANDOFF_URGENCY_EMOJI[lead.handoff_urgency] : "🔔"}{" "}
            <strong>
              {lead.handoff_reason
                ? HANDOFF_REASON_LABEL[lead.handoff_reason] ?? lead.handoff_reason
                : "handoff"}
            </strong>
            {lead.handoff_urgency ? ` · ${lead.handoff_urgency}` : null}
          </div>
          {lead.handoff_attempts !== undefined ? (
            <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {lead.handoff_attempts} tentativa(s)
            </div>
          ) : null}
          <Link
            href={`/handoff/${lead.id}`}
            className="ctx-cta"
            style={{ marginTop: 10 }}
          >
            Revisar handoff →
          </Link>
        </section>
      ) : null}

      {/* Handoff histórico — já escalado em algum momento, bridge ativa ou fechada */}
      {lead.handoff_notified_at && lead.bridge_active ? (
        <section className="ctx-section">
          <h3>Handoff em curso</h3>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            Ponte aberta com corretor. Avalie o timing quando concluir.
          </div>
          <Link
            href={`/handoff/${lead.id}`}
            className="ctx-cta"
            style={{ marginTop: 10 }}
          >
            Avaliar handoff →
          </Link>
        </section>
      ) : null}

      {/* Qualificação */}
      <section className="ctx-section">
        <h3>Qualificação</h3>
        <dl className="ctx-kv">
          {renderKv("tipo", q.tipo)}
          {renderKv("quartos", q.quartos)}
          {renderKv("cidade", q.cidade)}
          {renderKv("bairros", Array.isArray(q.bairros) ? q.bairros.join(", ") : q.bairros)}
          {renderKv("faixa preço", fmtPrice(q.faixa_preco_min, q.faixa_preco_max))}
          {renderKv("finalidade", q.finalidade)}
          {renderKv("prazo", q.prazo)}
          {renderKv("pagamento", q.pagamento)}
          {q.usa_fgts ? renderKv("FGTS", "sim") : null}
          {q.usa_mcmv ? renderKv("MCMV", "sim") : null}
        </dl>
      </section>

      {/* Brief/memória — só mostra se existir */}
      {lead.brief ? (
        <section className="ctx-section">
          <h3>Brief</h3>
          <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: 0, color: "var(--ink-2, var(--ink))" }}>
            {lead.brief}
          </p>
        </section>
      ) : null}

      {lead.memory ? (
        <section className="ctx-section">
          <h3>Memória</h3>
          <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, color: "var(--ink-3)" }}>
            {lead.memory.slice(0, 400)}
            {lead.memory.length > 400 ? "…" : ""}
          </p>
        </section>
      ) : null}

      {/* Timeline */}
      <section className="ctx-section">
        <h3>Eventos</h3>
        <Timeline leadId={lead.id} />
      </section>
    </aside>
  );
}

function renderKv(label: string, value: unknown) {
  if (value === undefined || value === null || value === "" || value === false) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </>
  );
}

function fmtPrice(min: unknown, max: unknown): string | null {
  const fmt = (n: unknown) =>
    typeof n === "number"
      ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
      : null;
  const a = fmt(min);
  const b = fmt(max);
  if (!a && !b) return null;
  if (a && b) return `${a} – ${b}`;
  return `até ${b ?? a}`;
}
