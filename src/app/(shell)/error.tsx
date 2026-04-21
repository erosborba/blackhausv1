"use client";

import { useEffect } from "react";

/**
 * Error boundary do shell — aparece se uma rota filha lançar durante
 * SSR ou client. Next chama `reset` pra tentar re-renderizar o
 * segmento sem recarregar a página inteira.
 *
 * O detalhe do erro vai pro console (útil em dev/prod com source
 * maps); usuário vê mensagem genérica + botão pra tentar de novo.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[shell/error]", error);
  }, [error]);

  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 42, opacity: 0.4, marginBottom: 14 }}>💥</div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 300,
            letterSpacing: "-0.01em",
            margin: "0 0 8px",
            color: "var(--ink)",
          }}
        >
          Algo quebrou aqui do lado
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            margin: "0 0 18px",
          }}
        >
          Não é culpa sua. Tenta de novo — se o problema persistir, o
          corretor pode continuar operando pelo WhatsApp enquanto
          resolvemos.
        </p>
        {error.digest ? (
          <p
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--ink-4)",
              margin: "0 0 14px",
            }}
          >
            id: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            background: "var(--surface-3)",
            border: "1px solid var(--hairline)",
            color: "var(--ink-2)",
            padding: "8px 18px",
            borderRadius: 10,
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
