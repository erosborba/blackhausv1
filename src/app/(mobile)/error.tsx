"use client";

import { useEffect } from "react";

export default function MobileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[mobile/error]", error);
  }, [error]);

  return (
    <div style={{ padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 40, opacity: 0.5 }}>💥</div>
      <h1
        style={{
          fontSize: 18,
          fontWeight: 400,
          margin: "10px 0 6px",
          color: "var(--ink)",
        }}
      >
        Algo quebrou
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--ink-3)",
          margin: "0 0 16px",
        }}
      >
        {error.digest ? `id: ${error.digest}` : "Tenta de novo?"}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          background: "var(--surface-3)",
          border: "1px solid var(--hairline)",
          color: "var(--ink-2)",
          padding: "10px 20px",
          borderRadius: 12,
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
