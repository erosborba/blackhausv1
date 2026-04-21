import type { HTMLAttributes } from "react";

export type DotTone = "default" | "hot" | "warm" | "ok" | "cool" | "muted";

export function Dot({
  tone = "default",
  className,
  ...rest
}: { tone?: DotTone; className?: string } & HTMLAttributes<HTMLSpanElement>) {
  const classes = ["bh-dot", tone !== "default" && tone, className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} {...rest} />;
}
