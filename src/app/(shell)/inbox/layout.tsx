import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Topbar } from "@/components/shell/Topbar";
import { supabaseAdmin } from "@/lib/supabase";
import type { InboxItem } from "@/components/inbox/types";
import { InboxLayoutShell } from "./InboxLayoutShell";
import "@/components/inbox/inbox.css";

export const dynamic = "force-dynamic";

/**
 * Layout do /inbox — carrega `inbox_items` uma vez e mantém rails estáveis
 * enquanto o usuário navega entre threads. Sem esse hoisting, toda seleção
 * de conversa disparava novo SSR do `page.tsx` e flashava skeleton.
 */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  const { agent } = await getSession();
  const role = agent?.role ?? "admin";
  if (role !== "admin" && role !== "corretor") redirect("/brief");

  const sb = supabaseAdmin();
  const { data } = await sb.rpc("inbox_items", {
    search_text: null,
    p_agent_id: role === "corretor" && agent ? agent.id : null,
  });
  const items = (data ?? []) as InboxItem[];

  return (
    <>
      <Topbar crumbs={[{ label: "Inbox" }]} />
      <InboxLayoutShell items={items}>{children}</InboxLayoutShell>
    </>
  );
}
