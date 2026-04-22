import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 4: /admin/configuracoes foi absorvido pela aba IA em /ajustes.
 * Redirect preserva bookmarks antigos.
 */
export default function LegacyConfiguracoesPage() {
  redirect("/ajustes");
}
