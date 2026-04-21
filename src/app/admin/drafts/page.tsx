import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 4: /admin/drafts foi absorvido pelo /revisao (dashboard unificado
 * com overview, pendentes e aprendizado). Mantém o redirect pra não
 * quebrar bookmarks da equipe.
 */
export default function LegacyDraftsPage() {
  redirect("/revisao");
}
