/**
 * Sistema de perfis — admin vs corretor.
 *
 * Fase atual (Phase 0–4): role é lido de `system_settings.current_role`
 * como stub single-user. Na Phase 5, a fonte vira Supabase Auth + tabela
 * `agents` (cada corretor tem um agent.id + email; admin é flag).
 *
 * O contrato `can(role, perm)` NÃO muda entre as fases — só a fonte do
 * `role`. Isso mantém o UI gate estável durante toda a reconstrução.
 */

export type Role = "admin" | "corretor";

export type Permission =
  // Inbox
  | "inbox.view_all"          // admin vê todos os leads; corretor só os atribuídos a ele
  | "inbox.reassign"          // reatribuir lead pra outro corretor
  | "inbox.takeover"          // tomar o fio da IA (pause_ia)
  // Empreendimentos
  | "empreendimentos.view"
  | "empreendimentos.edit"
  | "empreendimentos.create"
  | "empreendimentos.import"  // import PDF
  | "empreendimentos.delete"
  // Gestor / KPIs
  | "gestor.view"             // dashboard de KPIs + alertas operacionais
  | "gestor.export"           // exportar CSV/Excel
  // Ajustes
  | "ajustes.view"
  | "ajustes.ia_config"       // thresholds, prompts, modelos
  | "ajustes.costs"           // custos, usage, billing
  | "ajustes.manutencao"      // cleanup, reseed
  // Revisão / aprendizado
  | "revisao.view"            // drafts pendentes + draft_learnings
  | "revisao.approve"
  // Handoff
  | "handoff.add_to_faq"      // promover resposta pra FAQ do empreendimento
  | "handoff.close_ticket"
  // Pipeline
  | "pipeline.view"
  | "pipeline.move_stage";    // arrastar card entre estágios

/** Matriz de permissões. Single source of truth. */
const PERMS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "inbox.view_all",
    "inbox.reassign",
    "inbox.takeover",
    "empreendimentos.view",
    "empreendimentos.edit",
    "empreendimentos.create",
    "empreendimentos.import",
    "empreendimentos.delete",
    "gestor.view",
    "gestor.export",
    "ajustes.view",
    "ajustes.ia_config",
    "ajustes.costs",
    "ajustes.manutencao",
    "revisao.view",
    "revisao.approve",
    "handoff.add_to_faq",
    "handoff.close_ticket",
    "pipeline.view",
    "pipeline.move_stage",
  ]),
  corretor: new Set<Permission>([
    // Corretor vê apenas os próprios leads.
    "inbox.takeover",
    "empreendimentos.view",
    "handoff.add_to_faq",
    "handoff.close_ticket",
    "pipeline.view",
    "pipeline.move_stage",
  ]),
};

/** Gate puro — chamável de client ou server. */
export function can(role: Role, permission: Permission): boolean {
  return PERMS[role].has(permission);
}

/** Atalho pra checar múltiplas perms (AND). */
export function canAll(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => PERMS[role].has(p));
}

/** Atalho pra checar múltiplas perms (OR). */
export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => PERMS[role].has(p));
}

/** Role default — usado quando não há sessão (dev). */
export const DEFAULT_ROLE: Role = "admin";

// `getCurrentRole()` agora vive em `./role-server` (server-only). Imports do
// client — RoleProvider, MobileShell, etc. — ficam só com os tipos + can()
// puros. Callers server mudam `from "@/lib/auth/role"` → `"@/lib/auth/role-server"`.
