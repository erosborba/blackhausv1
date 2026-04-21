import type { HTMLAttributes } from "react";

export type OrbState = "idle" | "breath" | "thinking" | "asking";
export type OrbSize = "sm" | "md" | "lg";

/**
 * Animated AI presence indicator. Estados:
 * - breath (default): respiração calma — IA ativa e pronta
 * - thinking: processando — hue-rotate sutil
 * - asking: IA pediu ajuda (âmbar pulsante) — usado em handoff
 * - idle: sem animação, opacidade reduzida
 */
export function Orb({
  state = "breath",
  size = "md",
  className,
  ...rest
}: { state?: OrbState; size?: OrbSize; className?: string } & HTMLAttributes<HTMLDivElement>) {
  const classes = [
    "orb",
    size !== "md" && size,
    state === "thinking" && "thinking",
    state === "asking" && "asking",
    state === "idle" && "idle",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} aria-hidden="true" {...rest} />;
}

/** Chip com mini-orb — "IA ativa", "gerado pela IA 07:12", etc. */
export function OrbChip({
  label,
  children,
  className,
  ...rest
}: { label?: string; className?: string } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={["orb-chip", className].filter(Boolean).join(" ")} {...rest}>
      <span className="mini" aria-hidden="true" />
      {label ? <span className="label">{label}</span> : null}
      {children}
    </span>
  );
}
