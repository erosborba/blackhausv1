"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botão "Executar agora" + resultado da última execução manual.
 *
 * Chama POST /api/admin/cleanup (sem CRON_SECRET — admin auth implícita,
 * mesmo padrão do resto do /admin). Ao terminar, faz `router.refresh()`
 * pra puxar o estado novo (oldest created_at etc).
 */

type TaskResult = {
  ok: boolean;
  task: string;
  removed: number;
  durationMs: number;
  error?: string;
};

type RunResponse = {
  ok: boolean;
  results?: TaskResult[];
  totalRemoved?: number;
  durationMs?: number;
  error?: string;
};

export function CleanupRunner() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResponse | null>(null);

  async function run() {
    if (running) return;
    if (!confirm("Rodar todas as rotinas de limpeza agora?")) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin/cleanup", { method: "POST" });
      const j: RunResponse = await r.json();
      setResult(j);
      router.refresh();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={running}
        style={{
          background: running ? "#1f1f27" : "#2a2a32",
          color: "#e7e7ea",
          border: "1px solid #3a3a44",
          borderRadius: 8,
          padding: "8px 14px",
          fontSize: 13,
          cursor: running ? "wait" : "pointer",
        }}
      >
        {running ? "Rodando…" : "Executar agora"}
      </button>

      {result && (
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            background: "#0f0f14",
            border: "1px solid #2a2a32",
            borderRadius: 8,
            padding: "10px 12px",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {result.ok === false && !result.results && (
            <div style={{ color: "#ff9fa8" }}>Erro: {result.error}</div>
          )}
          {result.results && (
            <>
              <div style={{ marginBottom: 6, color: "#8f8f9a" }}>
                Concluído em {result.durationMs}ms · removidos:{" "}
                <strong style={{ color: "#e7e7ea" }}>{result.totalRemoved}</strong>
              </div>
              {result.results.map((t) => (
                <div key={t.task} style={{ color: t.ok ? "#c5c5d0" : "#ff9fa8" }}>
                  {t.ok ? "✓" : "✗"} {t.task}: {t.removed} removido(s) ({t.durationMs}ms)
                  {t.error && <span> — {t.error}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
