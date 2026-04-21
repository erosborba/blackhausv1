import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 1: threadview legacy substituída por /inbox/[id] (3-col com
 * context rail, HUD, timeline). Redirect preserva o id.
 */
export default async function LegacyLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/inbox/${id}`);
}
