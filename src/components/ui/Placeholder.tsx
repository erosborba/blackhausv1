import type { CSSProperties, HTMLAttributes } from "react";

/** Skeleton hachurado neumórfico — usado pra imagens/embeds antes de carregar. */
export function Placeholder({
  label,
  style,
  className,
  ...rest
}: { label?: string; style?: CSSProperties; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["ph", className].filter(Boolean).join(" ")}
      style={style}
      {...rest}
    >
      {label ?? ""}
    </div>
  );
}
