"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PipelineLead } from "@/lib/pipeline";

type Column = {
  stage: string;
  label: string;
  hint: string;
  leads: PipelineLead[];
  count: number;
};

type Snapshot = {
  byStage: Record<string, PipelineLead[]>;
  count: Record<string, number>;
};

/**
 * Kanban drag-drop nativo (HTML5). Otimista: move o card localmente
 * assim que o drop acontece, chama POST /api/pipeline/move em background.
 * Se der erro, reverte e mostra banner.
 *
 * Por que HTML5 nativo e não react-dnd/dnd-kit: (a) sem deps, (b) inputs
 * teclado-acessíveis via <button> fallback abaixo do card, (c) uma coluna
 * costuma ter < 50 cards — perf não é gargalo.
 */
export function PipelineBoard({
  columns,
  canMove,
}: {
  columns: Column[];
  canMove: boolean;
}) {
  const router = useRouter();

  const initial = useMemo<Snapshot>(() => {
    const byStage: Record<string, PipelineLead[]> = {};
    const count: Record<string, number> = {};
    for (const c of columns) {
      byStage[c.stage] = c.leads;
      count[c.stage] = c.count;
    }
    return { byStage, count };
  }, [columns]);

  const [state, setState] = useState<Snapshot>(initial);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Sempre renderiza na ordem das props (colunas estáveis)
  const render = columns.map((c) => ({
    ...c,
    leads: state.byStage[c.stage] ?? [],
    count: state.count[c.stage] ?? 0,
  }));

  const move = useCallback(
    async (leadId: string, fromStage: string, toStage: string) => {
      if (fromStage === toStage) return;
      const before = state;

      // Otimista.
      setState((prev) => {
        const nextBy: Record<string, PipelineLead[]> = { ...prev.byStage };
        const fromList = [...(nextBy[fromStage] ?? [])];
        const idx = fromList.findIndex((l) => l.id === leadId);
        if (idx === -1) return prev;
        const [moved] = fromList.splice(idx, 1);
        nextBy[fromStage] = fromList;
        nextBy[toStage] = [moved, ...(nextBy[toStage] ?? [])];

        const nextCount = { ...prev.count };
        nextCount[fromStage] = Math.max(0, (nextCount[fromStage] ?? 1) - 1);
        nextCount[toStage] = (nextCount[toStage] ?? 0) + 1;

        return { byStage: nextBy, count: nextCount };
      });

      try {
        const res = await fetch("/api/pipeline/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lead_id: leadId, to_stage: toStage }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(typeof json.error === "string" ? json.error : "Falha ao mover");
        }
        // Revalida timeline/inbox.
        router.refresh();
      } catch (e) {
        setState(before);
        setError(e instanceof Error ? e.message : "Falha ao mover");
      }
    },
    [state, router],
  );

  const onDragStart = (e: React.DragEvent<HTMLDivElement>, leadId: string) => {
    if (!canMove) return;
    setDraggedId(leadId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", leadId);
  };
  const onDragEnd = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  return (
    <div className="kanban-wrap">
      {error ? (
        <div className="kanban-err">
          {error}
          <button onClick={() => setError(null)} className="kanban-err-x">×</button>
        </div>
      ) : null}

      <div className="kanban">
        {render.map((col) => {
          const fromStage = draggedId
            ? Object.keys(state.byStage).find((s) =>
                state.byStage[s]?.some((l) => l.id === draggedId),
              ) ?? null
            : null;
          const isValidTarget = Boolean(draggedId && fromStage && fromStage !== col.stage);

          return (
            <section
              key={col.stage}
              className={`kb-col ${dropTarget === col.stage && isValidTarget ? "drop" : ""}`}
              onDragOver={(e) => {
                if (!canMove || !isValidTarget) return;
                e.preventDefault();
                setDropTarget(col.stage);
              }}
              onDragLeave={() => {
                if (dropTarget === col.stage) setDropTarget(null);
              }}
              onDrop={(e) => {
                if (!canMove) return;
                e.preventDefault();
                const leadId = e.dataTransfer.getData("text/plain") || draggedId;
                if (!leadId || !fromStage) return;
                setDropTarget(null);
                setDraggedId(null);
                void move(leadId, fromStage, col.stage);
              }}
            >
              <header className="kb-col-head">
                <div className="kb-col-title">
                  <span className="kb-col-name">{col.label}</span>
                  <span className="kb-col-count">{col.count}</span>
                </div>
                {col.hint ? <div className="kb-col-hint">{col.hint}</div> : null}
              </header>

              <div className="kb-col-body">
                {col.leads.length === 0 ? (
                  <div className="kb-empty">—</div>
                ) : (
                  col.leads.map((l) => (
                    <LeadCard
                      key={l.id}
                      lead={l}
                      draggable={canMove}
                      onDragStart={(e) => onDragStart(e, l.id)}
                      onDragEnd={onDragEnd}
                      dimmed={draggedId === l.id}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  draggable,
  onDragStart,
  onDragEnd,
  dimmed,
}: {
  lead: PipelineLead;
  draggable: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  dimmed?: boolean;
}) {
  const tone =
    lead.score >= 80 ? "hot" : lead.score >= 60 ? "warm" : lead.score >= 30 ? "cool" : "idle";
  return (
    <div
      className={`kb-card ${dimmed ? "dimmed" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="kb-card-row">
        <span className={`kb-dot ${tone}`} />
        <Link href={`/inbox/${lead.id}`} className="kb-card-name">
          {lead.name ?? lead.phone}
        </Link>
        <span className="kb-card-score">{lead.score}</span>
      </div>
      <div className="kb-card-meta">
        {lead.handoff_notified_at ? (
          <span className="kb-badge warn">handoff</span>
        ) : null}
        <span className="kb-card-phone">{lead.phone}</span>
      </div>
      {lead.last_message_at ? (
        <div className="kb-card-time">{timeAgo(lead.last_message_at)}</div>
      ) : null}
    </div>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
