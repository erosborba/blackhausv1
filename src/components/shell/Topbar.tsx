"use client";

import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/Kbd";
import { OrbChip } from "@/components/ui/Orb";

export type Crumb = { label: string; href?: string };

/**
 * Topbar 64px com blur — crumbs + search ⌘K + slot direito (chips/ações).
 *
 * O callback `onSearchOpen` vai subir pro AppShell quando CommandPalette
 * for ligada (Phase 1). Por enquanto é noop.
 */
export function Topbar({
  crumbs,
  right,
  onSearchOpen,
}: {
  crumbs: Crumb[];
  right?: ReactNode;
  onSearchOpen?: () => void;
}) {
  return (
    <header className="topbar" role="banner">
      <nav className="crumb" aria-label="Caminho">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {i > 0 ? <span className="sep">/</span> : null}
            {c.href ? (
              <a
                href={c.href}
                style={{ color: "inherit", textDecoration: "none", fontWeight: i === crumbs.length - 1 ? 600 : 400 }}
              >
                {i === crumbs.length - 1 ? <strong>{c.label}</strong> : c.label}
              </a>
            ) : i === crumbs.length - 1 ? (
              <strong>{c.label}</strong>
            ) : (
              <span>{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <button
        type="button"
        className="search"
        onClick={onSearchOpen}
        aria-label="Buscar (Ctrl+K)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span>Buscar leads, empreendimentos...</span>
        <Kbd keys={["Ctrl", "K"]} />
      </button>
      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
        <OrbChip label="IA ativa" />
        {right}
      </div>
    </header>
  );
}
