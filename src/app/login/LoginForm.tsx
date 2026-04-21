"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state === "sending") return;
    setState("sending");
    setErr(null);
    try {
      const res = await fetch("/api/auth/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body?.error ?? "send_failed");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setErr("network");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="login-sent">
        <div className="login-sent-icon">✓</div>
        <div>
          <strong>Link enviado pra {email}</strong>
          <p>Abre o email e clica. Se não chegar em 2min, checa spam.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <label className="login-label" htmlFor="login-email">
        Email cadastrado
      </label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        required
        placeholder="voce@blackhaus.site"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="login-input"
        disabled={state === "sending"}
      />
      {err ? <div className="login-alert login-alert-inline">{err}</div> : null}
      <button
        type="submit"
        className="login-btn"
        disabled={state === "sending" || !email.trim()}
      >
        {state === "sending" ? "Enviando…" : "Receber link"}
      </button>
    </form>
  );
}
