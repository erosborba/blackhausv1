import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 3: /admin/follow-ups foi absorvido pela /agenda (aba Follow-ups).
 * Mantém o redirect pra não quebrar bookmarks dos gestores.
 */
export default function LegacyFollowUpsPage() {
  redirect("/agenda?tab=follow-ups");
}
