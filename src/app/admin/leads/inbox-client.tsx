"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export type InboxItem = {
  id: string;
  phone: string;
  push_name: string | null;
  full_name: string | null;
  status: string | null;
  stage: string | null;
  qualification: Record<string, unknown> | null;
  agent_notes: string | null;
  human_takeover: boolean;
  last_message_at: string | null;
  last_message_content: string | null;
  last_message_direction: "inbound" | "outbound" | null;
};

const container: CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "32px 20px",
};

const headerRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 20,
};

const searchInput: CSSProperties = {
  background: "#0b0b0d",
  border: "1px solid #2a2a32",
  borderRadius: 8,
  padding: "8px 12px",
  color: "#e7e7ea",
  fontSize: 14,
  width: 260,
  fontFamily: "inherit",
};

const list: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
};

const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 160px 100px",
  gap: 16,
  padding: "14px 20px",
  borderBottom: "1px solid #2a2a32",
  alignItems: "center",
  textDecoration: "none",
  color: "inherit",
  cursor: "pointer",
};

const chip = (bg: string, fg: string): CSSProperties => ({
  background: bg,
  color: fg,
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  display: "inline-block",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 500,
});

function statusChip(status: string | null) {
  switch (status) {
    case "qualified":
      return chip("#1e3a2b", "#6bd99b");
    case "qualifying":
      return chip("#2b2e1e", "#d9cf6b");
    case "won":
      return chip("#1e2b3a", "#6b9dd9");
    case "lost":
      return chip("#3a1e1e", "#d96b6b");
    default:
      return chip("#2a2a32", "#8f8f9a");
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

export function InboxClient({ initial }: { initial: InboxItem[] }) {
  const [items, setItems] = useState(initial);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel("inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        async () => {
          // Qualquer mudança em messages -> recarrega a lista via API.
          try {
            const res = await fetch("/api/admin/inbox", { cache: "no-store" });
            const json = await res.json();
            if (json.ok) setItems(json.data);
          } catch (e) {
            console.error("[inbox] refresh error", e);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads" },
        async () => {
          try {
            const res = await fetch("/api/admin/inbox", { cache: "no-store" });
            const json = await res.json();
            if (json.ok) setItems(json.data);
          } catch (e) {
            console.error("[inbox] refresh error", e);
          }
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [i.phone, i.push_name, i.full_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <main style={container}>
      <div style={headerRow}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Inbox</h1>
        <input
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInput}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...list, padding: 40, textAlign: "center", color: "#8f8f9a" }}>
          Nenhum lead ainda.
        </div>
      ) : (
        <div style={list}>
          {filtered.map((lead, idx) => {
            const name = lead.full_name || lead.push_name || lead.phone;
            const preview = lead.last_message_content
              ? (lead.last_message_direction === "outbound" ? "Bia: " : "") +
                lead.last_message_content.slice(0, 80)
              : "—";
            return (
              <Link
                key={lead.id}
                href={`/admin/leads/${lead.id}`}
                style={{
                  ...row,
                  borderBottom:
                    idx === filtered.length - 1 ? "none" : "1px solid #2a2a32",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 14 }}>{name}</strong>
                    {lead.human_takeover && (
                      <span style={chip("#3a2b1e", "#d9a66b")}>pausada</span>
                    )}
                  </div>
                  <div
                    style={{
                      color: "#8f8f9a",
                      fontSize: 13,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {preview}
                  </div>
                </div>
                <div style={{ textAlign: "left" }}>
                  <span style={statusChip(lead.status)}>{lead.status ?? "—"}</span>
                </div>
                <div style={{ color: "#8f8f9a", fontSize: 13, textAlign: "right" }}>
                  {timeAgo(lead.last_message_at)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
