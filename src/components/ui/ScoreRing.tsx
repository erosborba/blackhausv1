/**
 * Score ring 0–100 com conic-gradient.
 * Cor da seção preenchida muda com a nota (≥80 ok, ≥60 cool, ≥40 warm, <40 hot).
 */
export function ScoreRing({
  value,
  size = "md",
  label,
}: {
  value: number;
  size?: "sm" | "md";
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 80 ? "#34d399" : pct >= 60 ? "#4aa3ff" : pct >= 40 ? "#ffc861" : "#ff7a59";
  const accent =
    pct >= 80 ? "#5eead4" : pct >= 60 ? "#5eead4" : pct >= 40 ? "#ffd07a" : "#ff8a6a";

  return (
    <div
      className={["score-ring", size === "sm" && "sm"].filter(Boolean).join(" ")}
      style={{
        background: `conic-gradient(from -90deg, ${accent} 0%, ${color} ${pct}%, rgba(255,255,255,0.05) ${pct}% 100%)`,
      }}
      role="img"
      aria-label={label ?? `Score ${pct} de 100`}
    >
      <div className="num">
        {pct}
        <small>SCORE</small>
      </div>
    </div>
  );
}
