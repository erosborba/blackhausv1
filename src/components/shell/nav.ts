import type { Permission, Role } from "@/lib/auth/role";
import { canAny } from "@/lib/auth/role";

/**
 * Itens de navegação — single source of truth. Visibilidade depende das
 * permissões; se o usuário não tiver nenhuma das `requires`, o item somem.
 *
 * Ícones são identificados por `icon` e resolvidos no componente <SideIcon>.
 * Isso evita arrastar SVGs em server components.
 */
export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: NavIconName;
  requires?: Permission[]; // se vazio, todos veem
  badge?: number;          // opcional: badge numérico
  section?: "primary" | "secondary";
};

export type NavIconName =
  | "inbox"
  | "brief"
  | "gestor"
  | "pipeline"
  | "agenda"
  | "empreendimentos"
  | "handoff"
  | "revisao"
  | "ajustes";

export const NAV_ITEMS: NavItem[] = [
  { id: "inbox", label: "Inbox", href: "/inbox", icon: "inbox", section: "primary" },
  { id: "brief", label: "Brief", href: "/brief", icon: "brief", section: "primary" },
  {
    id: "pipeline",
    label: "Pipeline",
    href: "/pipeline",
    icon: "pipeline",
    requires: ["pipeline.view"],
    section: "primary",
  },
  {
    id: "agenda",
    label: "Agenda",
    href: "/agenda",
    icon: "agenda",
    section: "primary",
  },
  {
    id: "empreendimentos",
    label: "Empreendimentos",
    href: "/empreendimentos",
    icon: "empreendimentos",
    requires: ["empreendimentos.view"],
    section: "primary",
  },
  {
    id: "gestor",
    label: "Gestor",
    href: "/gestor",
    icon: "gestor",
    requires: ["gestor.view"],
    section: "secondary",
  },
  {
    id: "revisao",
    label: "Revisão",
    href: "/revisao",
    icon: "revisao",
    requires: ["revisao.view"],
    section: "secondary",
  },
  {
    id: "ajustes",
    label: "Ajustes",
    href: "/ajustes",
    icon: "ajustes",
    requires: ["ajustes.view"],
    section: "secondary",
  },
];

/** Filtra itens por role — chamar no server antes de passar pro Sidebar. */
export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!item.requires || item.requires.length === 0) return true;
    return canAny(role, item.requires);
  });
}
