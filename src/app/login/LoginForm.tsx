"use client";

import { useEffect, useRef, useState } from "react";

type Step = "email" | "code";
type State = "idle" | "sending" | "verifying" | "error";

const OTP_LENGTH = 8;

export function LoginForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<State>("idle");
  const [err, setErr] = useState<string | null>(null);

  async function onSendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state === "sending") return;
    setState("sending");
    setErr(null);
    try {
      const res = await fetch("/api/auth/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body?.error ?? "send_failed");
        setState("error");
        return;
      }
      setStep("code");
      setState("idle");
    } catch {
      setErr("network");
      setState("error");
    }
  }

  async function verify(code: string) {
    if (code.length !== OTP_LENGTH || state === "verifying") return;
    setState("verifying");
    setErr(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: code, next }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        next?: string;
      };
      if (!res.ok || !body?.ok) {
        setErr(body?.error ?? "invalid_token");
        setState("error");
        setToken("");
        return;
      }
      window.location.href = body.next ?? next;
    } catch {
      setErr("network");
      setState("error");
    }
  }

  function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    void verify(token);
  }

  function backToEmail() {
    setStep("email");
    setToken("");
    setErr(null);
    setState("idle");
  }

  if (step === "code") {
    return (
      <form className="login-form" onSubmit={onSubmitCode}>
        <div className="login-step-head">
          <span className="login-eyebrow">Etapa 2 de 2</span>
          <h2 className="login-step-title">Código enviado</h2>
          <p className="login-step-sub">
            Mandamos pro <strong>{email}</strong>. Checa seu email (e spam).
          </p>
        </div>

        <OtpInput
          length={OTP_LENGTH}
          value={token}
          onChange={(v) => {
            setToken(v);
            if (err) setErr(null);
          }}
          onComplete={(v) => void verify(v)}
          disabled={state === "verifying"}
        />

        {err ? <div className="login-alert login-alert-inline">{errText(err)}</div> : null}

        <button
          type="submit"
          className="login-btn login-btn-primary"
          disabled={state === "verifying" || token.length !== OTP_LENGTH}
        >
          <span className="login-btn-label">
            {state === "verifying" ? "Verificando" : "Entrar"}
          </span>
          <span className="login-btn-arrow" aria-hidden="true">→</span>
        </button>

        <button
          type="button"
          className="login-btn-ghost"
          onClick={backToEmail}
          disabled={state === "verifying"}
        >
          ← Trocar email
        </button>
      </form>
    );
  }

  return (
    <form className="login-form" onSubmit={onSendEmail}>
      <div className="login-step-head">
        <span className="login-eyebrow">Etapa 1 de 2</span>
        <h2 className="login-step-title">Entrar</h2>
        <p className="login-step-sub">
          Digita seu email cadastrado — mandamos um código pra confirmar.
        </p>
      </div>

      <label className="login-field">
        <span className="login-field-label">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="voce@lumihaus.com.br"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="login-input"
          disabled={state === "sending"}
          autoFocus
        />
      </label>

      {err ? <div className="login-alert login-alert-inline">{errText(err)}</div> : null}

      <button
        type="submit"
        className="login-btn login-btn-primary"
        disabled={state === "sending" || !email.trim()}
      >
        <span className="login-btn-label">
          {state === "sending" ? "Enviando" : "Receber código"}
        </span>
        <span className="login-btn-arrow" aria-hidden="true">→</span>
      </button>
    </form>
  );
}

function OtpInput({
  length,
  value,
  onChange,
  onComplete,
  disabled,
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!disabled) refs.current[0]?.focus();
  }, [disabled]);

  function setDigit(i: number, d: string) {
    const next = (value.slice(0, i) + d + value.slice(i + 1)).slice(0, length);
    onChange(next);
    if (d && i < length - 1) refs.current[i + 1]?.focus();
    if (next.length === length && /^\d+$/.test(next)) {
      onComplete?.(next);
    }
  }

  function handleChange(i: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (clean.length <= 1) {
      setDigit(i, clean);
      return;
    }
    // digitado/colado com mais de um char — espalha
    const merged = (value.slice(0, i) + clean).slice(0, length);
    onChange(merged);
    const nextIdx = Math.min(merged.length, length - 1);
    refs.current[nextIdx]?.focus();
    if (merged.length === length) onComplete?.(merged);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (value[i]) {
        setDigit(i, "");
        e.preventDefault();
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        onChange(value.slice(0, i - 1) + value.slice(i));
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      refs.current[i + 1]?.focus();
      e.preventDefault();
    }
  }

  function handlePaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    e.preventDefault();
    const merged = (value.slice(0, i) + pasted).slice(0, length);
    onChange(merged);
    const nextIdx = Math.min(merged.length, length - 1);
    refs.current[nextIdx]?.focus();
    if (merged.length === length) onComplete?.(merged);
  }

  return (
    <div className="otp-row" role="group" aria-label={`Código de ${length} dígitos`}>
      {Array.from({ length }).map((_, i) => {
        const ch = value[i] ?? "";
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Dígito ${i + 1}`}
            maxLength={1}
            value={ch}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            disabled={disabled}
            data-filled={ch ? "1" : "0"}
            className="otp-box"
          />
        );
      })}
    </div>
  );
}

function errText(code: string): string {
  switch (code) {
    case "invalid_token":
      return "Código incorreto. Confere os dígitos e tenta de novo.";
    case "otp_expired":
      return "Código expirou ou já foi usado. Volta e pede outro.";
    case "send_failed":
      return "Não deu pra enviar. Tenta de novo.";
    case "network":
      return "Sem conexão. Tenta de novo.";
    default:
      return "Não deu. Tenta de novo.";
  }
}
