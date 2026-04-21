"use client";

import { useState } from "react";

/**
 * Aba Manutenção — botão "Executar agora" pro cron de cleanup.
 *
 * O endpoint /api/admin/cleanup roda `runAllCleanup` (varrer pontes
 * stale, drafts expirados, seed de system_settings). É seguro rodar
 * a qualquer hora — idempotente. Gate de permissão já é feito na page.
 */

type CleanupResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export function ManutencaoTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runCleanup() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cleanup", { method: "POST" });
      const json = (await res.json()) as CleanupResult;
      if (!json.ok) {
        setError(json.error ?? "falha no cleanup");
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro de rede");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="manut-card">
        <h3>Cleanup manual</h3>
        <p>
          Executa a rotina periódica de limpeza — pontes travadas, drafts
          expirados, eventos antigos. Mesma coisa que o cron chama por
          conta própria; aqui é útil quando você suspeita que um
          lead/ponte ficou em estado ruim e quer forçar a varredura.
        </p>
        <button
          type="button"
          className="manut-run"
          onClick={runCleanup}
          disabled={running}
        >
          {running ? "Executando…" : "Executar agora"}
        </button>
        {error ? (
          <pre className="manut-result manut-error">Erro: {error}</pre>
        ) : null}
        {result ? (
          <pre className="manut-result">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>

      <div className="manut-card">
        <h3>Reindex de empreendimentos</h3>
        <p>
          Refaz os embeddings dos chunks de conteúdo. Faça isso depois de
          um bulk edit ou importação grande. A ação vive na página do
          empreendimento (em Empreendimentos → [detalhe] → aba Docs).
        </p>
      </div>

      <div className="manut-card">
        <h3>Reset de memória do lead</h3>
        <p>
          Em breve: limpar cache de memória de um lead específico pra
          forçar nova extração. Hoje o TTL natural (60s) cobre a
          maioria dos casos.
        </p>
      </div>
    </div>
  );
}
