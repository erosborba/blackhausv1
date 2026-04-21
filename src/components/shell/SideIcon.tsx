import type { NavIconName } from "./nav";

/**
 * Ícones SVG linha fina — estilo dos mockups. Stroke em currentColor,
 * tamanho herdado do CSS `.side-item svg`.
 */
export function SideIcon({ name }: { name: NavIconName }) {
  switch (name) {
    case "inbox":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 13h4l2 3h6l2-3h4" />
          <path d="M3 13l2.5-8h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6Z" />
        </svg>
      );
    case "brief":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
        </svg>
      );
    case "gestor":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
        </svg>
      );
    case "pipeline":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="9.5" y="4" width="5" height="11" rx="1" />
          <rect x="16" y="4" width="5" height="7" rx="1" />
        </svg>
      );
    case "agenda":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case "empreendimentos":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 21V9l7-4 7 4v12" />
          <path d="M10 21v-6h4v6M7 11h1M13 11h1M7 15h1M16 15h1" />
          <path d="M17 9h4v12h-4" />
        </svg>
      );
    case "handoff":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 9l4-4M18 5h-4M18 5v4" />
          <path d="M10 15l-4 4M6 19h4M6 19v-4" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "revisao":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h12l4 4v12H4z" />
          <path d="M4 9h12M8 14h8M8 18h5" />
        </svg>
      );
    case "ajustes":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      );
  }
}
