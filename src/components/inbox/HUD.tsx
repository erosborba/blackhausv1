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
      if (isEditing) return;

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const first = actions[0]!;
        if (e.shiftKey) {
          onSendAction(first);
        } else {
          onPickAction(first);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [actions, onPickAction, onSendAction, suggest]);

  return (
    <div className="hud">
      <div className="hud-head">
        <span className="title">Próxima ação sugerida</span>
        {actions.length > 0 ? (
          <Chip tone="warm" dot className="hud-cta">
            {actions.length} opções
          </Chip>
        ) : null}
        <button
          type="button"
          className="btn sm ghost hud-cta"
          onClick={suggest}
          disabled={loading}
          title="Regenera sugestões (⌘⇧E)"
        >
          {loading ? "Pensando…" : actions.length ? "Regenerar" : "Sugerir com IA"}
        </button>
      </div>

      {actions.length > 0 ? (
        <>
          <div className="hud-actions">
            {actions.slice(0, 3).map((a, i) => (
              <button
                key={i}
                type="button"
                className={`hud-action${i === 0 ? " primary" : ""}`}
                onClick={(e) => {
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
                  {i === 0 ? <strong>{a.label}</strong> : a.label}
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      opacity: 0.75,
                      marginTop: 2,
                      fontWeight: 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.body}
                  </span>
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
            ↵ edita · ⇧↵ envia direto · ⌘⇧E regenera
          </div>
        </>
      ) : (
        <div className="hud-empty">
          {err ? (
            <span className="hud-error">{err}</span>
          ) : (
            <>
              Clique em <strong>Sugerir com IA</strong> pra ver 3 drafts prontos.
            </>
          )}
        </div>
      )}
    </div>
  );
});
