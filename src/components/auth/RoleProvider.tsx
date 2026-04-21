"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { can, canAll, canAny, type Permission, type Role } from "@/lib/auth/role";

type RoleContextValue = {
  role: Role;
  can: (permission: Permission) => boolean;
  canAll: (permissions: Permission[]) => boolean;
  canAny: (permissions: Permission[]) => boolean;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  const value = useMemo<RoleContextValue>(
    () => ({
      role,
      can: (p) => can(role, p),
      canAll: (ps) => canAll(role, ps),
      canAny: (ps) => canAny(role, ps),
    }),
    [role],
  );
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/** Hook primário pra gates em client components. */
export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error(
      "useRole() precisa estar dentro de <RoleProvider>. Coloque no layout da rota.",
    );
  }
  return ctx;
}

/** Atalho quando só precisa de `can`. */
export function useCan(permission: Permission): boolean {
  return useRole().can(permission);
}

/** Conditional render wrapper — `<Can permission="gestor.view">...</Can>` */
export function Can({
  permission,
  permissions,
  mode = "all",
  fallback,
  children,
}: {
  permission?: Permission;
  permissions?: Permission[];
  mode?: "all" | "any";
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const ctx = useRole();
  let ok = false;
  if (permission) ok = ctx.can(permission);
  else if (permissions) ok = mode === "all" ? ctx.canAll(permissions) : ctx.canAny(permissions);
  return ok ? <>{children}</> : <>{fallback ?? null}</>;
}
