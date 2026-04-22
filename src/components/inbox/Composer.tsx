"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

export type ComposerHandle = {
  /** Define o texto + coloca foco e cursor no final. */
  setDraft: (text: string) => void;
  /** Envia imediatamente (usado pelo HUD shift+enter). */
  sendNow: (text: string) => Promise<void>;
  focus: () => void;
};

type Props = {
  leadId: string;
  /** Controlado pelo parent pra permitir HUD popular o textarea. */
  initialText?: string;
  /** Notifica parent que corretor está digitando (pra pausar IA otimista). */
  onDraftChange?: (text: string) => void;
  /** Toggle "Devolver para IA após envio" — controlado pelo parent. */
  returnToIa: boolean;
  onToggleReturnToIa: () => void;
  /** Callback após envio bem-sucedido; recebe o texto pra o parent fazer echo otimista. */
  onSent?: (sentText: string) => void;
  onRequestSuggestion?: () => Promise<string | null>;
  suggesting?: boolean;
};

/**
 * Composer — caixa de envio do corretor.
 * Expõe `setDraft` / `sendNow` / `focus` via ref pro HUD e atalhos globais.
 */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    leadId,
    initialText = "",
    onDraftChange,
    returnToIa,
    onToggleReturnToIa,
    onSent,
    onRequestSuggestion,
    suggesting = false,
  },
  ref,
) {
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useImperativeHandle(
    ref,
    () => ({
      setDraft: (t: string) => {
        setText(t);
        queueMicrotask(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(t.length, t.length);
        });
      },
      sendNow: async (t: string) => {
        await sendInternal(t, { clearAfter: false });
      },
      focus: () => textareaRef.current?.focus(),
    }),
    // sendInternal closes over state but we only use it imperatively
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadId, returnToIa],
  );

  async function sendInternal(body: string, opts: { clearAfter: boolean }) {
    if (!body.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: body.trim(),
          returnToIa,
          takeover: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Falha ao enviar");
      }
      if (opts.clearAfter) setText("");
      onSent?.(body.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha de rede");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    await sendInternal(text, { clearAfter: true });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape") {
      setText("");
      e.currentTarget.blur();
    }
  }

  async function handleSuggest() {
    if (!onRequestSuggestion) return;
    try {
      const suggestion = await onRequestSuggestion();
      if (suggestion) {
        setText(suggestion);
        textareaRef.current?.focus();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sugestão falhou");
    }
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder="Escreva sua mensagem…  (⌘↵ envia, ↵ no HUD usa ação #1)"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onDraftChange?.(e.target.value);
          }}
          onKeyDown={handleKey}
          rows={1}
          disabled={sending}
        />
        <div className="composer-toolbar">
          {/* Sugerir com IA — funcional */}
          <button
            type="button"
            className="btn sm ghost"
            title="Pede pra Bia sugerir uma resposta"
            onClick={handleSuggest}
            disabled={suggesting || sending}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
            </svg>
            {suggesting ? "Pensando…" : "Sugerir"}
          </button>

          <span style={{ flex: 1 }} />

          {/* Toggle Devolver para IA — funcional */}
          <label
            className="toggle-inline"
            title="Ao enviar, devolve a conversa pra IA continuar"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: returnToIa ? "var(--blue)" : "var(--ink-4)",
              cursor: "pointer",
              letterSpacing: "0.03em",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={returnToIa}
              onChange={onToggleReturnToIa}
              style={{ accentColor: "var(--blue)", cursor: "pointer" }}
            />
            Devolver para IA
          </label>

          {/* Erro */}
          {err ? (
            <span style={{ fontSize: 11, color: "var(--hot)", fontFamily: "var(--font-mono)" }}>
              {err}
            </span>
          ) : null}

          {/* Enviar */}
          <button
            type="button"
            className="btn blue sm"
            onClick={send}
            disabled={sending || !text.trim()}
          >
            {sending ? "Enviando…" : "Enviar"}
            <span
              className="kbd"
              style={{
                background: "rgba(255,255,255,0.15)",
                borderColor: "rgba(255,255,255,0.2)",
                color: "#fff",
              }}
            >
              ⌘↵
            </span>
          </button>
        </div>
      </div>
    </div>
  );
});
