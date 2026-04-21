import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { can, type Permission, type Role } from "./role";

/**
 * Server-side gate pra rotas admin-only. Chamar no topo de uma server
 * page/route handler.
 *
 * Comportamento:
 *   - Sem sessão → redireciona pra /login (middleware já deveria ter
 *     feito isso, mas garante defesa em profundidade).
 *   - Sessão + role/permission OK → retorna o agent.
 *   - Role/permission negados → lança que vira 403 via error boundary.
 *
 * Uso:
 *   const agent = await requirePermission("gestor.view");
 */
export async function requirePermission(permission: Permission) {
  const { user, agent } = await getSession();
  if (!user) redirect("/login");

  // Em dev stub o agent pode não existir — cai pro role default.
  const role: Role = agent?.role ?? "admin";

  if (!can(role, permission)) {
    throw new ForbiddenError(permission);
  }
  return { user, agent, role };
}

export async function requireAdmin() {
  const { user, agent } = await getSession();
  if (!user) redirect("/login");
  if (agent && agent.role !== "admin") {
    throw new ForbiddenError("admin");
  }
  return { user, agent };
}

export class ForbiddenError extends Error {
  code = "FORBIDDEN" as const;
  constructor(detail: string) {
    super(`forbidden: ${detail}`);
    this.name = "ForbiddenError";
  }
}
