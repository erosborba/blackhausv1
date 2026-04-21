import type { HTMLAttributes } from "react";

export type AvatarProps = {
  name?: string | null;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "blue";
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

function initials(name?: string | null): string {
  if (!name) return "·";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  size = "md",
  variant = "default",
  className,
  children,
  ...rest
}: AvatarProps) {
  const classes = [
    "avatar",
    size !== "md" && size,
    variant !== "default" && variant,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} aria-label={name ?? undefined} {...rest}>
      {children ?? initials(name)}
    </div>
  );
}
