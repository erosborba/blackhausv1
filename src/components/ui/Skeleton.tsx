import type { CSSProperties } from "react";

/**
 * Skeleton primitivo — retângulos pulsantes. Uso principal: loading.tsx
 * de rotas server-rendered. Estrutura mimica o layout final pra evitar
 * reflow feio quando o conteúdo aparece.
 */
export function Skeleton({
  width,
  height = 16,
  radius = 6,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`bh-skel ${className ?? ""}`}
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "bh-skel-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function SkeletonBlock({
  height = 100,
  style,
}: {
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="bh-skel-block"
      style={{
        height,
        borderRadius: 12,
        background:
          "linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "bh-skel-shimmer 1.4s ease-in-out infinite",
        border: "1px solid var(--hairline)",
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

export function SkeletonList({
  count = 5,
  itemHeight = 64,
  gap = 8,
}: {
  count?: number;
  itemHeight?: number;
  gap?: number;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap }}
      aria-hidden="true"
      role="presentation"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} height={itemHeight} />
      ))}
    </div>
  );
}
