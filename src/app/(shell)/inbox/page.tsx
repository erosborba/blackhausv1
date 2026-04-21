import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Topbar } from "@/components/shell/Topbar";
import { PriorityRail } from "@/components/inbox/PriorityRail";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseAdmin } from "@/lib/supabase";
import type { InboxItem } from "@/components/inbox/types";
import "@/components/inbox/inbox.css";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { agent } = await getSession();
  const role = agent?.role ?? "admin";
  if (role !== "admin" && role !== "corretor") redirect("/brief");

  // Corretor só vê leads atribuídos a ele (filtro no RPC).
  const sb = supabaseAdmin();
  const { data } = await sb.rpc("inbox_items", {
    search_text: null,
    p_agent_id: role === "corretor" && agent ? agent.id : null,
  });
  const items = (data ?? []) as InboxItem[];

  return (
    <>
      <Topbar crumbs={[{ label: "Inbox" }]} />
      <div className="inbox-shell two-col">
        <PriorityRail activeId={null} initial={items} />
        <main style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <EmptyState
            title="Escolha uma conversa"
            hint="Use ⌘K pra buscar por nome ou telefone."
          />
        </main>
      </div>
    </>
  );
}
