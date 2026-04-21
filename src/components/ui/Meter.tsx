import { scoreTone } from "@/design/tokens";

export type MeterTone = "default" | "hot" | "warm" | "ok";

/** Barra horizontal 0–100. Se não passar `tone`, deduz de `value`. */
export function Meter({
  value,
  tone,
  ariaLabel,
}: {
  value: number;
  tone?: MeterTone;
  ariaLabel?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const derivedTone: MeterTone =
    tone ?? (scoreTone(pct) === "cool" ? "default" : scoreTone(pct) as MeterTone);
  const spanClass = derivedTone !== "default" ? derivedTone : "";
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={ariaLabel}
    >
      <span className={spanClass} style={{ width: `${pct}%` }} />
    </div>
  );
}
