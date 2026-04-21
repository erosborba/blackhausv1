import type { HTMLAttributes } from "react";

/** Renderização de teclas. Em macOS troca automaticamente Ctrl por ⌘. */
export function Kbd({
  keys,
  className,
  ...rest
}: { keys: string | string[]; className?: string } & HTMLAttributes<HTMLSpanElement>) {
  const items = Array.isArray(keys) ? keys : [keys];
  const rendered = items.map((k) => {
    if (typeof window !== "undefined" && /mac/i.test(navigator.platform)) {
      if (k === "Ctrl") return "⌘";
      if (k === "Alt") return "⌥";
      if (k === "Shift") return "⇧";
    }
    return k;
  });
  return (
    <span className={["kbd", className].filter(Boolean).join(" ")} {...rest}>
      {rendered.join(" ")}
    </span>
  );
}
