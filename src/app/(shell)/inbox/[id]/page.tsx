import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Topbar } from "@/components/shell/Topbar";
import { PriorityRail } from "@/components/inbox/PriorityRail";
import { InboxRail } from "@/components/inbox/Rail";
import { ThreadView } from "@/components/inbox/ThreadView";
import { ContextRail } from "@/components/inbox/ContextRail";
import { supabaseAdmin } from "@/lib/supabase";
import { getAgentName, getTopEmpreendimentoFromMessages } from "@/lib/lead-context";
import type { InboxItem, ThreadMessage } from "@/components/inbox/types";
import type { Lead } from "@/lib/leads";
import "@/components/inbox/inbox.css";

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

  const [listRes, leadRes, msgsRes] = await Promise.all([
    sb.rpc("inbox_items", {
      search_text: null,
      p_agent_id: role === "corretor" && agent ? agent.id : null,
    }),
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

  const items = (listRes.data ?? []) as InboxItem[];
  const lead = leadRes.data as Lead;
  const messages = ((msgsRes.data ?? []) as ThreadMessage[]).slice().reverse();
  const name = lead.full_name ?? lead.push_name ?? lead.phone;

  // Enriquecimento pro ContextRail — paralelo, tolerante a falha.
  const [agentName, topEmpreendimento] = await Promise.all([
    getAgentName(lead.assigned_agent_id ?? null),
    getTopEmpreendimentoFromMessages(lead.id),
  ]);

  return (
    <>
      <Topbar crumbs={[{ label: "Inbox", href: "/inbox" }, { label: name }]} />
      <div className="inbox-wrap">
        <InboxRail items={items} activeId={id} />
        <div className="inbox-shell">
          <PriorityRail activeId={id} initial={items} />
          <ThreadView lead={lead} initialMessages={messages} />
          <ContextRail
            lead={lead}
            agentName={agentName}
            topEmpreendimento={topEmpreendimento}
          />
        </div>
      </div>
    </>
  );
}
