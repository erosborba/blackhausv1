"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
};

export type Lead = {
  id: string;
  phone: string;
  push_name: string | null;
  full_name: string | null;
  email: string | null;
  status: string | null;
  stage: string | null;
  qualification: Record<string, unknown>;
  agent_notes: string | null;
  human_takeover: boolean;
  last_message_at: string | null;
  brief: string | null;
  brief_at: string | null;
  created_at: string;
};

const shell: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 320px",
  gap: 20,
  maxWidth: 1200,
  margin: "0 auto",
  padding: "24px 20px",
};

const card: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
};

const bubble = (direction: "inbound" | "outbound"): CSSProperties => ({
  maxWidth: "72%",
  padding: "10px 14px",
  borderRadius: 12,
  background: direction === "inbound" ? "#1c1c22" : "#1e3a5f",
  color: "#e7e7ea",
  fontSize: 14,
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
});

const metaLine: CSSProperties = {
  fontSize: 11,
  color: "#8f8f9a",
  marginTop: 4,
};

const sideLabel: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8f8f9a",
  marginBottom: 4,
};

const sideValue: CSSProperties = {
  fontSize: 14,
  color: "#e7e7ea",
  marginBottom: 12,
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderQualification(q: Record<string, unknown>) {
  const entries = Object.entries(q).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) {
    return <div style={{ color: "#8f8f9a", fontSize: 13 }}>Ainda não qualificado.</div>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.8 }}>
      {entries.map(([k, v]) => (
        <li key={k}>
          <span style={{ color: "#8f8f9a" }}>{k}:</span>{" "}
          <strong>{Array.isArray(v) ? v.join(", ") : String(v)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function ThreadClient({
  lead,
  initialMessages,
}: {
  lead: Lead;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [currentLead, setCurrentLead] = useState(lead);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`lead:${lead.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `id=eq.${lead.id}`,
        },
        (payload) => {
          setCurrentLead((prev) => ({ ...prev, ...(payload.new as Partial<Lead>) }));
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [lead.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const name = currentLead.full_name || currentLead.push_name || currentLead.phone;

  return (
    <main style={shell}>
      <section style={card}>
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #2a2a32",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <Link href="/admin/leads" style={{ color: "#8f8f9a", fontSize: 13, textDecoration: "none" }}>
              ← Inbox
            </Link>
            <h1 style={{ margin: "4px 0 0", fontSize: 18 }}>{name}</h1>
            <div style={{ color: "#8f8f9a", fontSize: 12 }}>{currentLead.phone}</div>
          </div>
          {currentLead.human_takeover && (
            <span
              style={{
                background: "#3a2b1e",
                color: "#d9a66b",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Bia pausada
            </span>
          )}
        </header>

        <div
          ref={scrollRef}
          style={{
            maxHeight: "calc(100vh - 200px)",
            minHeight: 400,
            overflowY: "auto",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ color: "#8f8f9a", textAlign: "center", marginTop: 40 }}>
              Nenhuma mensagem.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: m.direction === "inbound" ? "flex-start" : "flex-end",
                  flexDirection: "column",
                  alignItems: m.direction === "inbound" ? "flex-start" : "flex-end",
                }}
              >
                <div style={bubble(m.direction)}>{m.content}</div>
                <div style={metaLine}>
                  {m.direction === "inbound" ? name : "Bia"} · {formatTime(m.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...card, padding: 20 }}>
          <div style={sideLabel}>Status</div>
          <div style={sideValue}>{currentLead.status ?? "—"}</div>

          <div style={sideLabel}>Estágio</div>
          <div style={sideValue}>{currentLead.stage ?? "—"}</div>

          <div style={sideLabel}>Telefone</div>
          <div style={sideValue}>{currentLead.phone}</div>
        </div>

        <div style={{ ...card, padding: 20 }}>
          <div style={sideLabel}>Qualificação</div>
          {renderQualification(currentLead.qualification)}
        </div>

        {currentLead.agent_notes && (
          <div style={{ ...card, padding: 20 }}>
            <div style={sideLabel}>Dicas pra Bia</div>
            <div style={{ fontSize: 13, color: "#e7e7ea", whiteSpace: "pre-wrap" }}>
              {currentLead.agent_notes}
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}
