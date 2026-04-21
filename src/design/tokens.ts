/**
 * Design tokens — espelho TS do `tokens.css`.
 *
 * Use **sempre** o CSS var (`var(--bg)`) em estilos. Este módulo só existe
 * pra quando precisar do valor em JS (cálculo de cor, inline style residual,
 * canvas, SVG dinâmico).
 *
 * Se editar um valor aqui, edite também em `tokens.css` — CSS é a fonte
 * primária.
 */

export const color = {
  bg: "#0e1624",
  bg2: "#0a1120",
  bg3: "#111b2d",
  surface: "#152136",
  surface2: "#18253d",
  surface3: "#0f1828",
  surfaceHi: "#1b2a44",

  ink: "#eaf1ff",
  ink2: "#c7d2e6",
  ink3: "#8ea0bf",
  ink4: "#64748b",
  ink5: "#3d4a63",

  hairline: "rgba(255,255,255,0.04)",
  hairline2: "rgba(255,255,255,0.09)",

  blue: "#4aa3ff",
  blue2: "#2563eb",
  blueDeep: "#0b2a55",
  blueTint: "rgba(74,163,255,0.14)",
  blueTint2: "rgba(74,163,255,0.28)",
  blueInk: "#8fc0ff",
  cyan: "#5eead4",

  hot: "#ff7a59",
  hotInk: "#ffb399",
  warm: "#ffc861",
  warmInk: "#ffe0a3",
  ok: "#34d399",
  okInk: "#86efac",
  cool: "#60a5fa",
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
} as const;

/** Tom semântico de status — mapeia pra classes CSS `.chip.hot` etc. */
export type Tone = "default" | "hot" | "warm" | "ok" | "cool" | "blue-soft" | "ghost" | "solid";

export const font = {
  sans: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
  display: '"Instrument Serif", "Times New Roman", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
} as const;

/** Pesos semânticos (0–100) → cor de meter. Usado em score/confidence. */
export function scoreTone(n: number): "hot" | "warm" | "ok" | "cool" {
  if (n >= 80) return "ok";
  if (n >= 60) return "cool";
  if (n >= 40) return "warm";
  return "hot";
}
