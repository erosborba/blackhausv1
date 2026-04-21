"use client";

import { useEffect, useState } from "react";
import type { SuggestedAction } from "./types";

/**
 * HUD — 3 pills de ações sugeridas. Click → copia pra clipboard e avisa.
 * Phase 2 vai wirar "enviar direto" (usa a API do handoff/bridge).
 *
 * Fetch on-demand: botão "Sugerir" aciona a IA só quando o corretor pedir,
 * pra não queimar Haiku a cada render. Cacheado no servidor por 30s.
 */
export function HUD({ leadId }: { leadId: string }) {
  const [actions, setActions] = useState<SuggestedAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function suggest() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/suggested-actions`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "ai_failed");
      setActions(json.data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falhou");
    } finally {
      setLoading(false);
    }
  }

  // Reset quando muda de lead
  useEffect(() => {
    setActions([]);
    setErr(null);
  }, [leadId]);

  async function pickAction(a: SuggestedAction) {
    try {
      await navigator.clipboard.writeText(a.body);
      setToast(`Copiado: ${a.label}`);
      setTimeout(() => setToast(null), 1800);
    } catch {
      setToast("Falha ao copiar");
      setTimeout(() => setToast(null), 1800);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono)",
          }}
        >
          Ações sugeridas
        </span>
        <button
          type="button"
          onClick={suggest}
          disabled={loading}
          style={{
            fontSize: 11.5,
            padding: "3px 10px",
            borderRadius: 999,
            background: "var(--surface-3)",
            color: "var(--blue)",
            border: "1px solid var(--hairline)",
            cursor: "pointer",
          }}
        >
          {loading ? "Pensando…" : actions.length ? "Regenerar" : "Sugerir"}
        </button>
        {toast ? (
          <span style={{ fontSize: 11, color: "var(--blue)" }}>{toast}</span>
        ) : null}
        {err ? (
          <span style={{ fontSize: 11, color: "#ff6b6b" }}>{err}</span>
        ) : null}
      </div>
      <div className="hud">
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            className="hud-pill"
            onClick={() => pickAction(a)}
            title={a.body}
          >
            <span>{a.label}</span>
            <span className="tone">{a.tone}</span>
          </button>
        ))}
        {actions.length === 0 && !loading ? (
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
            Clique em Sugerir pra ver 3 drafts prontos.
          </span>
        ) : null}
      </div>
    </div>
  );
}
