import { supabaseAdmin } from "@/lib/supabase";
import { InboxClient, type InboxItem } from "./inbox-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadInbox(): Promise<InboxItem[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("inbox_items", { search_text: null });
  if (error) {
    console.error("[inbox] load error:", error);
    return [];
  }
  return (data ?? []) as InboxItem[];
}

export default async function LeadsPage() {
  const initial = await loadInbox();
  return <InboxClient initial={initial} />;
}
