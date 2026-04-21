"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftAction, DraftConfidence } from "@/lib/drafts";

export type SwipeCard = {
  id: string;
  lead_id: string;
  leadName: string;
  agentName: string | null;
  confidence: DraftConfidence;
  action: DraftAction;
  proposed_text: string;
  created_at: string;
};

/**
 * Stack de cartões com swipe lateral — Tinder-style.
 *
 * Implementação sem lib:
 *  - Pointer Events (works for touch + mouse)
 *  - CSS transform pra translação + rotação
 *  - threshold de 100px ou 35% da largura pra disparar decisão
 *  - "return home" animado quando swipe não chega no threshold
 *
 * Optei por não usar framer-motion porque:
 *  - bundle size (+50kb gz) pesa em mobile
 *  - a API de pointer events dá controle total dos micro-ajustes
 *  - todo state é local; sem reordenação complexa
 *
 * Decisões (approve/reject) chamam /api/admin/drafts/:id/action — mesma
 * API do /revisao desktop.
 */
export function SwipeStack({
  cards: initial,
  canApprove,
}: {
  cards: SwipeCard[];
  canApprove: boolean;
}) {
  // Usa chave estável derivada do primeiro snapshot; se a prop mudar por
  // revalidação da server component a stack reinicia (OK — raro).
  const [queue, setQueue] = useState(initial);
  const [committing, setCommitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQueue(initial);
  }, [initial]);

  const top = queue[0];
  const next = queue[1];

  async function act(id: string, action: "approved" | "ignored") {
    if (!canApprove) {
      // Apenas avança o deck sem gravar
      setQueue((q) => q.filter((c) => c.id !== id));
      return;
    }
    setCommitting(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/drafts/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          final_text: action === "ignored" ? null : (queue.find((c) => c.id === id)?.proposed_text ?? null),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "falha");
      setQueue((q) => q.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setCommitting(null);
    }
  }

  return (
    <div className="m-stack-wrap" aria-label="Stack de decisões">
      <p className="m-stack-hint">
        {queue.length} na fila · {canApprove ? "Decisão grava no banco." : "Somente leitura."}
      </p>

      <div className="m-stack-area">
        {queue.length === 0 ? (
          <div className="m-empty">
            <div className="m-empty-title">Fila concluída 🎉</div>
            Volta mais tarde — novos drafts aparecem aqui.
          </div>
        ) : (
          <>
            {next ? <CardView card={next} isBack committing={false} /> : null}
            {top ? (
              <Swipeable
                key={top.id}
                card={top}
                committing={committing === top.id}
                onDecide={(action) => act(top.id, action)}
              />
            ) : null}
          </>
        )}
      </div>

      {error ? (
        <p style={{ color: "#d96b6b", fontSize: 12, textAlign: "center", margin: "8px 0" }}>
          Erro ao salvar: {error}
        </p>
      ) : null}

      {top ? (
        <div className="m-stack-buttons">
          <button
            type="button"
            className="m-stack-btn is-reject"
            onClick={() => act(top.id, "ignored")}
            disabled={committing !== null}
          >
            Ignorar
          </button>
          <button
            type="button"
            className="m-stack-btn is-approve"
            onClick={() => act(top.id, "approved")}
            disabled={committing !== null}
          >
            Aprovar ✓
          </button>
        </div>
      ) : null}
    </div>
  );
}

const SWIPE_THRESHOLD_PX = 100;
const SWIPE_FLY_PX = 480;

function Swipeable({
  card,
  committing,
  onDecide,
}: {
  card: SwipeCard;
  committing: boolean;
  onDecide: (action: "approved" | "ignored") => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState<"left" | "right" | null>(null);

  const rot = useMemo(() => dx / 18, [dx]);
  const opacityRight = Math.min(1, Math.max(0, dx / SWIPE_THRESHOLD_PX));
  const opacityLeft = Math.min(1, Math.max(0, -dx / SWIPE_THRESHOLD_PX));

  function onPointerDown(e: React.PointerEvent) {
    if (committing || flying) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const delta = e.clientX - start.current.x;
    setDx(delta);
  }

  function onPointerUp() {
    if (!start.current) return;
    const delta = dx;
    start.current = null;
    if (delta > SWIPE_THRESHOLD_PX) {
      fly("right");
      return;
    }
    if (delta < -SWIPE_THRESHOLD_PX) {
      fly("left");
      return;
    }
    // Volta pra origem (animado via transition CSS inline)
    setDx(0);
  }

  function fly(dir: "left" | "right") {
    setFlying(dir);
    setDx(dir === "right" ? SWIPE_FLY_PX : -SWIPE_FLY_PX);
    // Espera a animação visual antes de commitar
    window.setTimeout(() => {
      onDecide(dir === "right" ? "approved" : "ignored");
    }, 220);
  }

  const transition = flying ? "transform 220ms ease-out, opacity 220ms" : start.current ? "none" : "transform 200ms ease-out";
  const opacity = flying ? 0 : 1;

  return (
    <div
      ref={ref}
      className="m-swipe-card"
      style={{
        transform: `translateX(${dx}px) rotate(${rot}deg)`,
        transition,
        opacity,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="m-swipe-corner corner-right" style={{ opacity: opacityRight }}>
        Aprovar
      </div>
      <div className="m-swipe-corner corner-left" style={{ opacity: opacityLeft }}>
        Ignorar
      </div>
      <CardContent card={card} />
    </div>
  );
}

function CardView({
  card,
  isBack,
  committing,
}: {
  card: SwipeCard;
  isBack: boolean;
  committing: boolean;
}) {
  return (
    <div
      className={`m-swipe-card ${isBack ? "is-back" : ""}`}
      aria-hidden={isBack}
      style={committing ? { opacity: 0.5 } : undefined}
    >
      <CardContent card={card} />
    </div>
  );
}

function CardContent({ card }: { card: SwipeCard }) {
  return (
    <>
      <div className="m-swipe-head">
        <span className={`m-swipe-conf conf-${card.confidence}`}>{card.confidence}</span>
        <span className="m-swipe-count">{timeAgo(card.created_at)}</span>
      </div>
      <div className="m-swipe-lead">{card.leadName}</div>
      <div className="m-swipe-meta">
        {card.agentName ? `agente ${card.agentName}` : "sem agente"}
      </div>
      <div className="m-swipe-text">{card.proposed_text}</div>
    </>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h atrás`;
  const d = Math.floor(hr / 24);
  return `${d}d atrás`;
}
