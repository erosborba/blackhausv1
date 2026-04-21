"use client";

import { useEffect, useState } from "react";
import type { TimelineEvent } from "./types";

const KIND_LABEL: Record<string, string> = {
  status_change: "Status alterado",
  stage_change: "Estágio alterado",
  handoff_requested: "Handoff solicitado",
  handoff_resolved: "Handoff resolvido",
  assigned: "Atribuído",
  bridge_opened: "Ponte aberta",
  bridge_closed: "Ponte fechada",
  draft_edited: "Draft editado",
  memory_refreshed: "Memória atualizada",
  factcheck_blocked: "Factcheck bloqueou resposta",
  score_jump: "Score saltou",
  note_added: "Nota adicionada",
  handoff_feedback: "Handoff avaliado",
};

const HANDOFF_RATING_COPY: Record<string, string> = {
  bom: "🎯 Foi bom",
  cedo: "⏩ Cedo demais",
  tarde: "⏪ Tarde demais",
  lead_ruim: "🗑️ Lead ruim",
};

function fmtPayload(kind: string, p: Record<string, unknown>): string {
  if (!p || Object.keys(p).length === 0) return "";
  if (kind === "status_change" || kind === "stage_change") {
    return `${p.from ?? "—"} → ${p.to ?? "—"}`;
  }
  if (kind === "score_jump") {
    return `${p.from ?? "—"} → ${p.to ?? "—"} (${(p.delta as number) > 0 ? "+" : ""}${p.delta ?? 0})`;
  }
  if (kind === "handoff_requested") {
    return `${p.reason ?? "—"} · ${p.urgency ?? "—"}`;
  }
  if (kind === "handoff_feedback") {
    const label = HANDOFF_RATING_COPY[String(p.rating)] ?? String(p.rating);
    const note = p.note ? ` · "${String(p.note).slice(0, 40)}"` : "";
    return `${label}${note}`;
  }
  // Fallback: mostra keys:values abreviado
  return Object.entries(p)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v).slice(0, 24)}`)
    .join(" · ");
}

function fmtWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function Timeline({ leadId }: { leadId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/leads/${leadId}/timeline?limit=30`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (alive && json.ok) setEvents(json.data);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [leadId]);

  if (loading && events.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--ink-4)" }}>Carregando…</div>;
  }
  if (events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
        Sem eventos ainda.
      </div>
    );
  }

  return (
    <div>
      {events.map((ev) => (
        <div key={ev.id} className="timeline-ev">
          <span className="dot" />
          <div>
            <div className="kind">{KIND_LABEL[ev.kind] ?? ev.kind}</div>
            {fmtPayload(ev.kind, ev.payload) ? (
              <div className="payload">{fmtPayload(ev.kind, ev.payload)}</div>
            ) : null}
            <div className="at">{fmtWhen(ev.at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
