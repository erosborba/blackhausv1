import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 1: o inbox legacy foi substituído por /inbox (3-col com score,
 * priority rail, HUD de sugestões). Mantemos esta rota só pra não quebrar
 * bookmarks — redireciona sem feedback.
 *
 * Depreciação final na Phase 3 quando o legacy /admin/* todo for aposentado.
 */
export default function LegacyLeadsPage() {
  redirect("/inbox");
}
