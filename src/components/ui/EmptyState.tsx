import type { ReactNode } from "react";

/** Empty state canônico — todo empty/loading/error da app passa por aqui. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  variant = "empty",
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  variant?: "empty" | "loading" | "error";
}) {
  const tone =
    variant === "error" ? "hot" : variant === "loading" ? "cool" : "muted";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "60px 20px",
        textAlign: "center",
        color: "var(--ink-3)",
      }}
    >
      {icon ? <div className={`bh-dot ${tone}`} style={{ width: 14, height: 14 }} /> : null}
      <h3 style={{ fontSize: 15, color: "var(--ink)", margin: 0 }}>{title}</h3>
      {hint ? (
        <p style={{ fontSize: 12.5, color: "var(--ink-4)", margin: 0, maxWidth: 340 }}>
          {hint}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}
