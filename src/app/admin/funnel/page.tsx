import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 2: dashboard operacional migrado pra /gestor (novo shell, KPIs com
 * sparklines, alertas, acurácia de handoff). O período (`?days=`) é
 * preservado pra não quebrar bookmarks dos gestores.
 */
export default async function LegacyFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const d = sp?.days ? `?days=${encodeURIComponent(sp.days)}` : "";
  redirect(`/gestor${d}`);
}
