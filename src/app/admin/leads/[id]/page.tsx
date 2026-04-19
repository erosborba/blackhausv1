import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { ThreadClient, type Message, type Lead } from "./thread-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadLead(id: string) {
  const sb = supabaseAdmin();
  const [leadQ, msgsQ] = await Promise.all([
    sb.from("leads").select("*").eq("id", id).maybeSingle(),
    sb
      .from("messages")
      .select("id, direction, role, content, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);
  if (leadQ.error || !leadQ.data) return null;
  return {
    lead: leadQ.data as Lead,
    messages: (msgsQ.data ?? []) as Message[],
  };
}

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadLead(id);
  if (!data) return notFound();
  return <ThreadClient lead={data.lead} initialMessages={data.messages} />;
}
