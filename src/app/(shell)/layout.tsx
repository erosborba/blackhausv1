import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

export const dynamic = "force-dynamic";

/**
 * Layout raiz das rotas novas — envolve tudo em <AppShell>.
 * Rotas sob este grupo NÃO herdam do layout root de /admin.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
