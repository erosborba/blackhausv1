"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth/role";

type TabKey = "brief" | "decisions" | "inbox" | "agenda";
type Tab = {
  key: TabKey;
  label: string;
  href: string;
  icon: ReactNode;
};

/**
 * Shell mobile — topbar magra com greeting + tabbar fixa inferior
 * (4 abas). Não usa RoleProvider nem CommandPalette; cada rota
 * mobile é auto-contida.
 *
 * Evitamos libs de navegação mobile — <Link> do Next cobre o básico
 * (prefetch + history) e o feel "nativo" é mais sobre transição e
 * tamanhos de toque que sobre router.
 */
const TABS: Tab[] = [
  {
    key: "brief",
    label: "Brief",
    href: "/m/brief",
    icon: <IconBrief />,
  },
  {
    key: "decisions",
    label: "Decisões",
    href: "/m/decisions",
    icon: <IconDecisions />,
  },
  {
    key: "inbox",
    label: "Inbox",
    href: "/m/inbox",
    icon: <IconInbox />,
  },
  {
    key: "agenda",
    label: "Agenda",
    href: "/m/agenda",
    icon: <IconAgenda />,
  },
];

export function MobileShell({
  children,
  role,
}: {
  children: ReactNode;
  role: Role;
}) {
  const pathname = usePathname() ?? "";
  const active = TABS.find((t) => pathname.startsWith(t.href))?.key ?? "brief";

  return (
    <div className="m-shell">
      <header className="m-topbar">
        <Link href="/m/brief" className="m-logo" aria-label="Início">
          BH
        </Link>
        <div className="m-title">{TABS.find((t) => t.key === active)?.label}</div>
        <Link href="/ajustes" className="m-top-cta" aria-label="Ajustes">
          <IconGear />
        </Link>
      </header>

      <main className="m-main" role="main">
        {children}
      </main>

      <nav className="m-tabbar" aria-label="Navegação principal">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`m-tab ${active === t.key ? "is-active" : ""}`}
            aria-current={active === t.key ? "page" : undefined}
          >
            <span className="m-tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="m-tab-label">{t.label}</span>
          </Link>
        ))}
      </nav>

      {/* Visual cue do role ativo — ajuda a não operar como admin sem querer. */}
      <div className={`m-role-cue m-role-${role}`} aria-hidden="true">
        {role}
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────
// SVG inline, sem lib. 20px, stroke-based pra seguir o padrão do Sidebar.

function IconBrief() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}
function IconDecisions() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="6" width="14" height="12" rx="2" />
      <path d="M8 10h8M8 14h5" />
      <path d="m15 17 2 2 2-2" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7H4V6Z" />
      <path d="M4 13h5l1 2h4l1-2h5v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" />
    </svg>
  );
}
function IconAgenda() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M4 10h16M8 4v4M16 4v4" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .7.42 1.32 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.24.61.86 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
    </svg>
  );
}
