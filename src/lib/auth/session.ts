import "server-only";
import { supabaseServer } from "./supabase-server";
import { supabaseAdmin } from "@/lib/supabase";
import type { Role } from "./role";

/**
 * Agent row do usuário logado — enxuto, só o que a UI precisa.
 * `null` quando não há sessão OU a sessão existe mas o email não
 * casou com nenhuma row de `public.agents`.
 */
export type SessionAgent = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  active: boolean;
  userId: string;
};

/**
 * Resolve a sessão atual + agent linkado. Uma chamada única pra evitar
 * round-trips duplicados por request — layouts costumam chamar isso
 * no servidor e derivar role/name/isAdmin daí.
 *
 * Estratégia:
 *   1. supabase.auth.getUser() — confia no cookie (validado pelo
 *      Supabase, não só decodificado).
 *   2. Se há user, busca agents.user_id = user.id (service-role pra
 *      contornar RLS em dev).
 *
 * Retornos:
 *   - { user, agent }: caminho feliz, login OK e mapeado.
 *   - { user, agent: null }: logado mas sem agent (tela de erro "pede
 *     acesso ao admin" no /login flow).
 *   - { user: null, agent: null }: não logado.
 */
export async function getSession(): Promise<{
  user: { id: string; email: string | null } | null;
  agent: SessionAgent | null;
}> {
  const supa = await supabaseServer();
  const { data: userData } = await supa.auth.getUser();
  const user = userData?.user;
  if (!user) return { user: null, agent: null };

  // Usa service-role pra query agents — RLS não impede, e evita exigir
  // policies só pra esse lookup.
  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, email, phone, role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    user: { id: user.id, email: user.email ?? null },
    agent: agent
      ? {
          id: agent.id as string,
          name: (agent.name as string) ?? "",
          email: (agent.email as string) ?? null,
          phone: (agent.phone as string) ?? null,
          role: (agent.role as Role) === "admin" ? "admin" : "corretor",
          active: Boolean(agent.active ?? true),
          userId: user.id,
        }
      : null,
  };
}

/** Atalho: só o agent, ou null. */
export async function getCurrentAgent(): Promise<SessionAgent | null> {
  const { agent } = await getSession();
  return agent;
}
