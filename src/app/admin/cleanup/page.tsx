import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 4: /admin/cleanup foi absorvido pela aba Manutenção em /ajustes.
 * Redirect preserva bookmarks antigos.
 */
export default function LegacyCleanupPage() {
  redirect("/ajustes?tab=manutencao");
}
