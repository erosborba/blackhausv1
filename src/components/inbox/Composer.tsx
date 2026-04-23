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

  // Auto-resize textarea (respeita min-height do CSS quando vazio)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!text) {
      el.style.height = "";
      return;
    }
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
          placeholder="Digite sua mensagem…"
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
          {/* Mídia — foto do empreendimento (em breve) */}
          <button
            type="button"
            className="composer-icon-btn"
            title="Enviar foto do empreendimento (em breve)"
            disabled
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </button>

          {/* Anexo — PDF / brochura (em breve) */}
          <button
            type="button"
            className="composer-icon-btn"
            title="Anexar arquivo (em breve)"
            disabled
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          {/* Sugerir com IA — funcional (ícone apenas) */}
          <button
            type="button"
            className="composer-icon-btn"
            title="Pede pra Bia sugerir uma resposta"
            onClick={handleSuggest}
            disabled={suggesting || sending}
          >
            {suggesting ? (
              <svg className="composer-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a10 10 0 1 0 10 10" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>

          <span style={{ flex: 1 }} />

          {/* Toggle Devolver para IA — funcional */}
          <label
            className={`composer-toggle${returnToIa ? " is-on" : ""}`}
            title="Ao enviar, devolve a conversa pra IA continuar"
          >
            <input
              type="checkbox"
              checked={returnToIa}
              onChange={onToggleReturnToIa}
            />
            Devolver IA
          </label>

          {/* Erro */}
          {err ? (
            <span style={{ fontSize: 11, color: "var(--hot)", fontFamily: "var(--font-mono)" }}>
              {err}
            </span>
          ) : null}

          {/* Enviar — botão circular verde-limão */}
          <button
            type="button"
            className="composer-send"
            onClick={send}
            disabled={sending || !text.trim()}
            title="Enviar mensagem (⌘↵)"
          >
            {sending ? (
              <svg className="composer-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a10 10 0 1 0 10 10" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
