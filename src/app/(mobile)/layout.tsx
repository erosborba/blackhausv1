import type { ReactNode } from "react";
import { MobileShell } from "@/components/mobile/MobileShell";
import { getCurrentRole } from "@/lib/auth/role-server";
import "@/design/tokens.css";
import "@/design/primitives.css";
import "@/components/mobile/mobile.css";

export const dynamic = "force-dynamic";

/**
 * Layout raiz do shell mobile. Rotas sob `(mobile)` servem a mesma
 * aplicação mas com UX focada em single-hand — tabbar fixa no rodapé,
 * sem sidebar, sem CommandPalette.
 *
 * O segmento de rota fica debaixo de `/m/*` via pasta `m/` dentro
 * deste grupo. O grupo em si não aparece na URL.
 */
export default async function MobileLayout({ children }: { children: ReactNode }) {
  const role = await getCurrentRole();
  return (
    <div className="bh bh-mobile">
      <MobileShell role={role}>{children}</MobileShell>
    </div>
  );
}
