import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "primary" | "ghost" | "icon";
type Size = "sm" | "md" | "lg";

export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "default",
  size = "md",
  leading,
  trailing,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    variant !== "default" && variant,
    size !== "md" && size,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...rest}>
      {leading}
      {children ? <span>{children}</span> : null}
      {trailing}
    </button>
  );
}
