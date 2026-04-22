import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ThreadView } from "@/components/inbox/ThreadView";
import { ContextRail } from "@/components/inbox/ContextRail";
import { supabaseAdmin } from "@/lib/supabase";
import { getAgentName, getTopEmpreendimentoFromMessages } from "@/lib/lead-context";
import type { ThreadMessage } from "@/components/inbox/types";
import type { Lead } from "@/lib/leads";

export const dynamic = "force-dynamic";

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { agent } = await getSession();
  const role = agent?.role ?? "admin";
  if (role !== "admin" && role !== "corretor") redirect("/brief");

  const { id } = await params;
  const sb = supabaseAdmin();

  const [leadRes, msgsRes] = await Promise.all([
    sb.from("leads").select("*").eq("id", id).maybeSingle(),
    sb
      .from("messages")
      .select(
        "id, role, direction, content, created_at, media_type, media_path, media_mime, media_duration_ms, sources",
      )
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  if (!leadRes.data) notFound();

  const lead = leadRes.data as Lead;
  const messages = ((msgsRes.data ?? []) as ThreadMessage[]).slice().reverse();

  const [agentName, topEmpreendimento] = await Promise.all([
    getAgentName(lead.assigned_agent_id ?? null),
    getTopEmpreendimentoFromMessages(lead.id),
  ]);

  return (
    <>
      <ThreadView lead={lead} initialMessages={messages} />
      <ContextRail
        lead={lead}
        agentName={agentName}
        topEmpreendimento={topEmpreendimento}
      />
    </>
  );
}
