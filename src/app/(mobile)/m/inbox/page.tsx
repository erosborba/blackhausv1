import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase";
import type { InboxItem } from "@/components/inbox/types";

export const dynamic = "force-dynamic";

/**
 * /m/inbox — lista vertical compacta de conversas. Clica → /m/inbox/[id]
 * (que por enquanto é um redirect pro desktop handoff se for handoff,
 * ou mostra thread simples; cabe evoluir depois).
 *
 * Corretor só vê seus leads atribuídos (via `p_agent_id` do RPC).
 */
export default async function MobileInboxPage() {
  const { agent } = await getSession();
  const role = agent?.role ?? "admin";
  if (role !== "admin" && role !== "corretor") redirect("/m/brief");

  const sb = supabaseAdmin();
  const { data } = await sb.rpc("inbox_items", {
    search_text: null,
    p_agent_id: role === "corretor" && agent ? agent.id : null,
  });
  const items = (data ?? []) as InboxItem[];

  if (items.length === 0) {
    return (
      <>
        <h1 className="m-page-title">Inbox</h1>
        <div className="m-empty">
          <div className="m-empty-title">Nenhuma conversa</div>
          Quando um lead escrever pelo WhatsApp, vai aparecer aqui.
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="m-page-title">Inbox</h1>
      <p className="m-page-sub">{items.length} conversas ativas.</p>

      <ul className="m-inbox-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.handoff_reason ? `/handoff/${item.id}` : `/inbox/${item.id}`}
              className="m-inbox-item"
            >
              <div className="m-inbox-avatar">{initials(item)}</div>
              <div className="m-inbox-body">
                <div className="m-inbox-head">
                  <div className="m-inbox-name">{displayName(item)}</div>
                  <div className="m-inbox-when">{timeAgo(item.last_message_at)}</div>
                </div>
                <div className="m-inbox-snippet">
                  {item.last_message_direction === "outbound" ? "↳ " : ""}
                  {item.last_message_content ?? "sem mensagens"}
                </div>
                {item.handoff_reason ? (
                  <span className="m-inbox-pill pill-handoff">handoff</span>
                ) : item.score >= 80 ? (
                  <span className="m-inbox-pill pill-hot">🔥 score {item.score}</span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function displayName(i: InboxItem): string {
  return i.full_name || i.push_name || i.phone;
}

function initials(i: InboxItem): string {
  const name = displayName(i);
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
