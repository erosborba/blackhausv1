"use client";

import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import type { SuggestedAction } from "./types";
import { Chip } from "@/components/ui/Chip";

const KBD_MAP: Record<number, string> = { 0: "↵", 1: "⇧↵", 2: "⌘⇧E" };

export type HUDHandle = {
  /** Dispara fetch de sugestões — usado pelo botão "Sugerir" do Composer. */
  suggest: () => Promise<SuggestedAction[]>;
};

type Props = {
  leadId: string;
  /** Popula o Composer com o body da ação (pra editar antes de enviar). */
  onPickAction: (action: SuggestedAction) => void;
  /** Envia direto sem passar pelo Composer (shift+enter ou alt+click). */
  onSendAction: (action: SuggestedAction) => void;
};

/**
 * HUD — ações sugeridas pela IA, estilo cockpit.
 * Interação:
 *  - Click ou ↵: popula o Composer (corretor revisa e envia com ⌘↵)
 *  - Shift+click ou ⇧↵: envia direto (pula revisão)
 */
export const HUD = forwardRef<HUDHandle, Props>(function HUD(
  { leadId, onPickAction, onSendAction },
  ref,
) {
  const [actions, setActions] = useState<SuggestedAction[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggest = useCallback(async (): Promise<SuggestedAction[]> => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/suggested-actions`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "ai_failed");
      const list: SuggestedAction[] = json.data ?? [];
      setActions(list);
      setSelectedIdx(0);
      return list;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falhou");
      return [];
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useImperativeHandle(ref, () => ({ suggest }), [suggest]);

  // Reset ao trocar lead
  useEffect(() => {
    setActions([]);
    setSelectedIdx(0);
    setErr(null);
  }, [leadId]);

  // Atalhos globais:
  //   ↵       → popula composer com ação #1 (se foco não está em textarea/input)
  //   ⇧↵      → envia ação #1 direto
  //   ⌘⇧E     → regenera sugestões
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable;

      // Regenerar
      if (e.key.toLowerCase() === "e" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        suggest();
        return;
      }

      if (actions.length === 0) return;

      // Setas ↑/↓ navegam entre sugestões — funcionam mesmo com foco no
      // textarea, mas só com Alt segurado pra não interferir no cursor.
      if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        actions.length > 1 &&
        (!isEditing || e.altKey)
      ) {
        e.preventDefault();
        setSelectedIdx((cur) => {
          const max = Math.min(actions.length, 3) - 1;
          if (e.key === "ArrowDown") return cur >= max ? 0 : cur + 1;
          return cur <= 0 ? max : cur - 1;
        });
        return;
      }

      if (isEditing) return;

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const picked = actions[selectedIdx] ?? actions[0]!;
        if (e.shiftKey) {
          onSendAction(picked);
        } else {
          onPickAction(picked);
        }
      }

      if (e.key === "Escape" && actions.length > 0) {
        e.preventDefault();
        setActions([]);
        setErr(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [actions, selectedIdx, onPickAction, onSendAction, suggest]);

  // Sem sugestões, sem loading e sem erro — o card não aparece.
  // Invocação fica no ícone ✨ do Composer.
  if (actions.length === 0 && !loading && !err) return null;

  return (
    <div className="hud task-card">
      <div className="task-card-head">
        <span className="task-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Task
        </span>
        <span className="task-title">
          {actions.length > 0 && actions[selectedIdx]
            ? actions[selectedIdx].label
            : actions[0]?.label ?? "Próxima ação"}
        </span>
        {actions.length > 0 ? (
          <Chip tone="cool" dot className="hud-cta">
            {actions.length} opções
          </Chip>
        ) : null}
        {actions.length > 0 ? (
          <button
            type="button"
            className="btn sm ghost hud-cta"
            onClick={suggest}
            disabled={loading}
            title="Regenera sugestões (⌘⇧E)"
          >
            {loading ? "Pensando…" : "Regenerar"}
          </button>
        ) : null}
        <button
          type="button"
          className="task-close"
          onClick={() => {
            setActions([]);
            setErr(null);
          }}
          title="Fechar sugestões (Esc)"
          aria-label="Fechar sugestões"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {actions.length > 0 ? (
        <>
          <div className="hud-actions">
            {actions.slice(0, 3).map((a, i) => (
              <button
                key={i}
                type="button"
                className={`hud-action${i === selectedIdx ? " primary" : ""}`}
                onClick={(e) => {
                  setSelectedIdx(i);
                  if (e.shiftKey) {
                    onSendAction(a);
                  } else {
                    onPickAction(a);
                  }
                }}
                title={`${a.body}\n\n(click: editar no composer · shift+click: enviar direto)`}
              >
                <span className="idx">{i + 1}</span>
                <div className="lbl">
                  {i === selectedIdx ? <strong>{a.label}</strong> : a.label}
                  <span className="hud-action-body">{a.body}</span>
                </div>
                <span className="kbd">{KBD_MAP[i] ?? `${i + 1}`}</span>
              </button>
            ))}
          </div>
          <div
            style={{
              fontSize: 10.5,
              fontFamily: "var(--font-mono)",
              color: "var(--ink-4)",
              letterSpacing: "0.03em",
              marginTop: 2,
            }}
          >
⌥↑↓ navega · ↵ edita · ⇧↵ envia direto · ⌘⇧E regenera · esc fecha
          </div>
        </>
      ) : loading ? (
        <div className="hud-empty">A Bia está pensando…</div>
      ) : err ? (
        <div className="hud-empty">
          <span className="hud-error">{err}</span>
        </div>
      ) : null}
    </div>
  );
});
