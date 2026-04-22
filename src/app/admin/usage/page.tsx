import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 4: /admin/usage foi absorvido pela aba Usage em /ajustes.
 * Redirect preserva bookmarks antigos.
 */
export default function LegacyUsagePage() {
  redirect("/ajustes?tab=usage");
}
