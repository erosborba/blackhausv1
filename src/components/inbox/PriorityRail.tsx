"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { InboxItem } from "./types";
import { ConvListItem } from "./ConvList";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseBrowser } from "@/lib/supabase";

type Filter = "all" | "handoff" | "qualified" | "new";

/** Classifica items em 3 buckets para as section heads da hifi. */
function groupItems(items: InboxItem[]): {
  action: InboxItem[];   // Precisam de ação — handoff pendente ou score >= 80
  ia: InboxItem[];       // IA atendendo — IA ativa, sem handoff
  waiting: InboxItem[];  // Aguardando cliente — enviamos, esperando resposta
} {
  const action: InboxItem[] = [];
  const ia: InboxItem[] = [];
  const waiting: InboxItem[] = [];

  for (const it of items) {
    const pendingHandoff =
      it.handoff_notified_at !== null &&
      !it.bridge_active &&
      !it.handoff_resolved_at;

    if (pendingHandoff || (it.score >= 80 && !it.human_takeover)) {
      action.push(it);
    } else if (it.human_takeover) {
      // Corretor assumiu — aguardando cliente
      waiting.push(it);
    } else if (it.last_message_direction === "outbound") {
      // Última mensagem foi saída — aguardando resposta
      waiting.push(it);
    } else {
      // IA atendendo (sem urgência, última msg recebida ou enviada pela IA)
      ia.push(it);
    }
  }

  return { action, ia, waiting };
}

/**
 * Painel esquerdo do inbox — lista de conversas com seções.
 * Busca + filtros topo; polling 15s.
 */
export function PriorityRail({ initial }: { initial: InboxItem[] }) {
  const pathname = usePathname();
  const activeId = pathname?.match(/^\/inbox\/([^/]+)/)?.[1] ?? null;

  const [items, setItems] = useState<InboxItem[]>(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);

  // Guard contra race: só aceita resposta se é a última query disparada.
  const reqIdRef = useRef(0);

  const refetch = useCallback(async (query: string, f: Filter) => {
    const rid = ++reqIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (f === "handoff") params.set("hasHandoff", "1");
      if (f === "qualified") params.set("status", "qualified");
      if (f === "new") params.set("status", "new");
      const res = await fetch(`/api/inbox/list?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok && rid === reqIdRef.current) setItems(json.data);
    } finally {
      if (rid === reqIdRef.current) setLoading(false);
    }
  }, []);

  // Debounce search; filter muda imediato
  useEffect(() => {
    const h = setTimeout(() => refetch(q, filter), q ? 250 : 0);
    return () => clearTimeout(h);
  }, [q, filter, refetch]);

  // Realtime: qualquer INSERT em messages OU UPDATE em leads redisparar um
  // refetch debounced. Polling 60s como safety-net.
  useEffect(() => {
    const sb = supabaseBrowser();
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => refetch(q, filter), 400);
    };

    const channel = sb
      .channel("inbox-list")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        scheduleRefetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads" },
        scheduleRefetch,
      )
      .subscribe();

    const iv = setInterval(() => refetch(q, filter), 60_000);
    return () => {
      clearInterval(iv);
      if (debounceHandle) clearTimeout(debounceHandle);
      sb.removeChannel(channel);
    };
  }, [q, filter, refetch]);

  const { action, ia, waiting } = groupItems(items);
  const totalActive = items.length;

  return (
    <div className="pane">
      {/* Cabeçalho pane */}
      <div className="pane-head">
        <h3>Conversas</h3>
        <span className="count">{totalActive} ativas</span>
      </div>

      {/* Busca */}
      <div className="conv-search">
        <input
          placeholder="Buscar por nome ou telefone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Filtros */}
      <div className="conv-filters">
        <FilterBtn label="Tudo" on={filter === "all"} onClick={() => setFilter("all")} />
        <FilterBtn label="Handoff" on={filter === "handoff"} onClick={() => setFilter("handoff")} />
        <FilterBtn label="Qualific." on={filter === "qualified"} onClick={() => setFilter("qualified")} />
        <FilterBtn label="Novos" on={filter === "new"} onClick={() => setFilter("new")} />
      </div>

      {/* Lista com seções */}
      <div className="conv-list">
        {loading && items.length === 0 ? (
          <EmptyState variant="loading" title="Carregando…" />
        ) : items.length === 0 ? (
          <EmptyState title={q ? `Nada para "${q}"` : "Sem conversas"} />
        ) : (
          <>
            {action.length > 0 ? (
              <>
                <div className="list-section-head">
                  <span>Precisam de ação · {action.length}</span>
                  <span className="dot hot" />
                </div>
                {action.map((it) => (
                  <ConvListItem key={it.id} item={it} active={it.id === activeId} />
                ))}
              </>
            ) : null}

            {ia.length > 0 ? (
              <>
                <div className="list-section-head" style={{ marginTop: action.length > 0 ? 10 : 0 }}>
                  IA atendendo · {ia.length}
                </div>
                {ia.map((it) => (
                  <ConvListItem key={it.id} item={it} active={it.id === activeId} />
                ))}
              </>
            ) : null}

            {waiting.length > 0 ? (
              <>
                <div className="list-section-head" style={{ marginTop: ia.length > 0 ? 10 : 0 }}>
                  Aguardando cliente · {waiting.length}
                </div>
                {waiting.map((it) => (
                  <ConvListItem key={it.id} item={it} active={it.id === activeId} />
                ))}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function FilterBtn({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`conv-filter${on ? " is-active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}
