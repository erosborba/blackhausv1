"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { NavItem } from "./nav";
import { SideIcon } from "./SideIcon";

/**
 * Sidebar vertical 68px — logo + itens neumórficos (light theme).
 * Items recebidos já vêm filtrados por role (server).
 * `footer` é renderizado no rodapé (UserChip etc).
 */
export function Sidebar({
  items,
  footer,
}: {
  items: NavItem[];
  footer?: ReactNode;
}) {
  const pathname = usePathname();
  const primary = items.filter((i) => i.section !== "secondary");
  const secondary = items.filter((i) => i.section === "secondary");

  return (
    <aside className="sidebar" aria-label="Navegação principal">
      <Link href="/brief" className="logo" aria-label="Lumihaus">
        l
      </Link>
      {primary.map((item) => (
        <SideLink key={item.id} item={item} active={isActive(pathname, item.href)} />
      ))}
      <div className="side-spacer" />
      {secondary.map((item) => (
        <SideLink key={item.id} item={item} active={isActive(pathname, item.href)} />
      ))}
      {footer ? <div className="sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={["side-item", active && "active"].filter(Boolean).join(" ")}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      title={item.label}
    >
      <SideIcon name={item.icon} />
      {item.badge && item.badge > 0 ? <span className="badge">{item.badge}</span> : null}
    </Link>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
