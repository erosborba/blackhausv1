"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/leads";
import type { ThreadMessage } from "./types";
import { Bubble } from "./Bubble";
import { Orb } from "@/components/ui/Orb";
import { Chip } from "@/components/ui/Chip";
import { HUD } from "./HUD";

/**
 * Coluna central do /inbox/[id] — thread de mensagens + header do lead +
 * HUD no rodapé. Faz polling de 5s pra captar novas mensagens (Phase 2
 * substitui por supabase realtime).
 */
export function ThreadView({
  lead,
  initialMessages,
}: {
  lead: Lead;
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const bodyRef = useRef<HTMLDivElement>(null);
  const name = lead.full_name ?? lead.push_name ?? lead.phone;

  // Poll de mensagens novas (3s — ativo o bastante pra UX de chat sem
  // inundar o banco). Se messages.length muda, rolar pro fim.
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch(`/api/leads/${lead.id}?limit=80`, { cache: "no-store" });
        const json = await res.json();
        if (alive && json.ok) setMessages(json.data.messages);
      } catch {
        // silencia — próximo tick tenta de novo
      }
    }
    const iv = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [lead.id]);

  // Auto-scroll pro fim quando chega msg nova
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages.length]);

  const orbState = lead.human_takeover ? "idle" : "breath";

  return (
    <section className="inbox-thread">
      <header className="thread-head">
        <Orb state={orbState} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="title">{name}</div>
          <div className="sub">
            {lead.phone}
            {lead.stage ? ` · ${lead.stage}` : ""}
            {lead.status ? ` · ${lead.status}` : ""}
          </div>
        </div>
        {lead.human_takeover ? (
          <Chip tone="warm">👋 Tomada humana</Chip>
        ) : (
          <Chip tone="ok">🤖 Bia ativa</Chip>
        )}
      </header>

      <div ref={bodyRef} className="thread-body">
        {messages.length === 0 ? (
          <div style={{ color: "var(--ink-4)", textAlign: "center", marginTop: 40 }}>
            Ainda sem mensagens.
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      <footer className="thread-foot">
        <HUD leadId={lead.id} />
      </footer>
    </section>
  );
}
