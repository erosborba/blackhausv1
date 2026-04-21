import type { ReactNode } from "react";

/**
 * Layout legacy das rotas /admin/*. Adiciona banner "versão clássica" no
 * topo de todas as páginas admin enquanto a reconstrução (fase 1–4) não
 * cobrir o equivalente novo.
 *
 * Deprecia na Phase 3 quando todas as rotas forem migradas.
 */
export default function AdminLegacyLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div
        style={{
          background:
            "linear-gradient(90deg, rgba(255, 200, 97, 0.14), rgba(255, 200, 97, 0.04))",
          borderBottom: "1px solid rgba(255, 200, 97, 0.28)",
          color: "#ffe0a3",
          padding: "8px 20px",
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          fontSize: 12.5,
          display: "flex",
          alignItems: "center",
          gap: 10,
          letterSpacing: "-0.005em",
        }}
      >
        <span style={{ fontSize: 14 }}>⚠️</span>
        <span>
          Você está na <strong style={{ color: "#fff", fontWeight: 600 }}>versão clássica</strong>.
          A nova experiência está sendo migrada por fases.
        </span>
        <a
          href="/ajustes"
          style={{
            marginLeft: "auto",
            color: "#8fc0ff",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Ir pra nova UI →
        </a>
      </div>
      {children}
    </>
  );
}
