import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /admin aposentado — shell unificado cobre tudo (/brief, /inbox, /gestor,
 * /ajustes). Redirect pro brief como landing padrão.
 */
export default function LegacyAdminIndex() {
  redirect("/brief");
}
