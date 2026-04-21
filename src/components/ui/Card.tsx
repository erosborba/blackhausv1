import type { HTMLAttributes } from "react";

export type CardProps = {
  variant?: "default" | "neu" | "inset";
  as?: "div" | "section" | "article";
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

export function Card({
  variant = "default",
  as = "div",
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = as;
  const classes = ["card", variant !== "default" && variant, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
