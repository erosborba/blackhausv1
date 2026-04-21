import type { ReactNode } from "react";
import { RoleProvider } from "@/components/auth/RoleProvider";
import { getSession } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/role";
import { Sidebar } from "./Sidebar";
import { UserChip } from "./UserChip";
import { CommandPalette } from "./CommandPalette";
import { navForRole } from "./nav";

/**
 * Server component raiz do shell. Resolve role + nav + agent no server,
 * entrega pros clients (Sidebar, CommandPalette, RoleProvider, UserChip)
 * via props.
 *
 * Todo conteúdo de rota deve ser renderizado com um <Topbar> + main.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const { agent } = await getSession();
  const role: Role = agent?.role ?? "admin";
  const nav = navForRole(role);

  const userChip = agent ? (
    <UserChip name={agent.name || agent.email || "Você"} email={agent.email} role={role} />
  ) : null;

  return (
    <RoleProvider role={role}>
      <div className="bh">
        <div className="app">
          <Sidebar items={nav} footer={userChip} />
          <div className="page">{children}</div>
        </div>
        <CommandPalette />
      </div>
    </RoleProvider>
  );
}
