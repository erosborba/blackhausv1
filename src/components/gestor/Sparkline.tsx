"use client";

/**
 * Sparkline inline (SVG puro, sem libs). Desenha um polyline suave dos
 * valores numa viewbox fixa; eixos implícitos (min=0 sempre, max=max
 * observado). Tooltip simples no hover via `title` do ponto.
 *
 * Design call: manter contained pra não arrastar recharts/d3 só pra isso.
 * Phase 3 (pipeline) pode trocar por lib se precisar interação complexa.
 */
export function Sparkline({
  values,
  labels,
  height = 36,
  stroke = "currentColor",
}: {
  values: number[];
  labels?: string[];
  height?: number;
  stroke?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const w = 120;
  const h = height;
  const stepX = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = h - (v / max) * h * 0.85 - 2;
    return [x, y] as const;
  });
  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  // Polygon fechado pro preenchimento suave abaixo da linha.
  const fillD = `${d} L${w},${h} L0,${h} Z`;

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: "block", color: stroke }}
      aria-hidden="true"
    >
      <path d={fillD} fill="currentColor" opacity="0.12" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.2" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.2" fill="currentColor">
          {labels && labels[i] ? (
            <title>{`${labels[i]}: ${values[i]}`}</title>
          ) : null}
        </circle>
      ))}
    </svg>
  );
}
