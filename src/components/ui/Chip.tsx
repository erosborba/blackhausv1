import type { HTMLAttributes, ReactNode } from "react";

export type ChipTone =
  | "default"
  | "ghost"
  | "solid"
  | "hot"
  | "warm"
  | "cool"
  | "ok"
  | "blue-soft";

export type ChipProps = {
  tone?: ChipTone;
  dot?: boolean;
  leading?: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLSpanElement>;

export function Chip({
  tone = "default",
  dot,
  leading,
  className,
  children,
  ...rest
}: ChipProps) {
  const classes = ["chip", tone !== "default" && tone, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
      {dot ? <span className="dot" /> : null}
      {leading}
      {children}
    </span>
  );
}
