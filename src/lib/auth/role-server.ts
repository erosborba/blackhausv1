import "server-only";
import { DEFAULT_ROLE, type Role } from "./role";

/**
 * Resolução de role server-only. Separado de `role.ts` pra esse arquivo
 * poder importar `session.ts` (que tem `server-only`) sem contaminar o
 * bundle do client.
 *
 * Ordem de resolução:
 *   1. Sessão Supabase Auth → agents.user_id → agents.role. Fonte canônica.
 *   2. Fallback: system_settings.current_role (stub single-user de dev).
 *      Só vale se NODE_ENV !== production OU BH_ALLOW_ROLE_STUB=1.
 *   3. DEFAULT_ROLE.
 *
 * Nunca lança — qualquer falha degrada pro stub/default.
 */
export async function getCurrentRole(): Promise<Role> {
  // 1. Supabase session.
  try {
    const { getCurrentAgent } = await import("./session");
    const agent = await getCurrentAgent();
    if (agent && agent.active) return agent.role;
  } catch {
    // cookies indisponíveis, env faltando, etc. — cai no fallback.
  }

  // 2. Stub de dev.
  const stubAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.BH_ALLOW_ROLE_STUB === "1";
  if (stubAllowed) {
    try {
      const { getSetting } = await import("@/lib/settings");
      const raw = await getSetting("current_role", DEFAULT_ROLE);
      return raw === "corretor" ? "corretor" : "admin";
    } catch {
      // settings falhou — default.
    }
  }

  return DEFAULT_ROLE;
}
