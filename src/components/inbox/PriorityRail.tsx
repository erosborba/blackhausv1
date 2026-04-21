"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InboxItem } from "./types";
import { ConvListItem } from "./ConvList";
import { EmptyState } from "@/components/ui/EmptyState";

type Filter = "all" | "handoff" | "qualified" | "new";

/**
 * Rail esquerdo do /inbox. Lista de conversas ordenada pela RPC (urgency >
 * score > recência). Busca + filtros topo; realtime via SSE/polling simples.
 */
export function PriorityRail({
  activeId,
  initial,
}: {
  activeId: string | null;
  initial: InboxItem[];
}) {
  const [items, setItems] = useState<InboxItem[]>(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);

  async function refetch(query: string, f: Filter) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (f === "handoff") params.set("hasHandoff", "1");
      if (f === "qualified") params.set("status", "qualified");
      if (f === "new") params.set("status", "new");
      const res = await fetch(`/api/inbox/list?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setItems(json.data);
    } finally {
      setLoading(false);
    }
  }

  // Debounce search. filter muda imediato.
  useEffect(() => {
    const h = setTimeout(() => refetch(q, filter), q ? 250 : 0);
    return () => clearTimeout(h);
  }, [q, filter]);

  // Poll a cada 15s pra captar mensagens novas sem realtime.
  // Phase 2 substitui por supabase.channel.on('INSERT'...).
  useEffect(() => {
    const iv = setInterval(() => refetch(q, filter), 15_000);
    return () => clearInterval(iv);
  }, [q, filter]);

  return (
    <aside className="inbox-rail">
      <div className="inbox-rail-head">
        <h2>Inbox</h2>
        <input
          className="inbox-search"
          placeholder="Buscar por nome ou telefone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="filters">
          <FilterChip label="Tudo" on={filter === "all"} onClick={() => setFilter("all")} />
          <FilterChip label="Handoff" on={filter === "handoff"} onClick={() => setFilter("handoff")} />
          <FilterChip label="Qualificados" on={filter === "qualified"} onClick={() => setFilter("qualified")} />
          <FilterChip label="Novos" on={filter === "new"} onClick={() => setFilter("new")} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && items.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState variant="loading" title="Carregando…" />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState title={q ? `Nada pra "${q}"` : "Sem conversas"} />
          </div>
        ) : (
          items.map((it) => (
            <ConvListItem key={it.id} item={it} active={it.id === activeId} />
          ))
        )}
      </div>
    </aside>
  );
}

function FilterChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11.5,
        padding: "3px 9px",
        borderRadius: 999,
        background: on ? "var(--blue)" : "var(--surface-3)",
        color: on ? "#fff" : "var(--ink-3)",
        border: `1px solid ${on ? "var(--blue)" : "var(--hairline)"}`,
        cursor: "pointer",
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}
