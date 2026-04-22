import type { ReactNode } from "react";

/**
 * Layout mínimo para rotas /admin/* — todas redirecionam pro shell novo.
 * Mantido só porque `admin/page.tsx` + children precisam de root wrapper.
 */
export default function AdminLegacyLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
