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
  const [filterOpen, setFilterOpen] = useState(false);
  const [worklistOpen, setWorklistOpen] = useState(true);
  const filterMenuRef = useRef<HTMLDivElement>(null);

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

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!filterOpen) return;
    function onDown(e: MouseEvent) {
      if (!filterMenuRef.current?.contains(e.target as Node)) setFilterOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  const FILTER_LABELS: Record<Filter, string> = {
    all: "Tudo",
    handoff: "Handoff",
    qualified: "Qualificados",
    new: "Novos",
  };

  // KPIs derivados dos items
  const todayStr = new Date().toDateString();
  const newToday = items.filter(
    (it) => it.last_message_at && new Date(it.last_message_at).toDateString() === todayStr,
  ).length;
  const updatesCount = action.length;
  const assignedToMe = items.filter((it) => it.human_takeover).length;

  return (
    <div className="pane pane-dark">
      {/* KPIs grid */}
      <div className="kpi-grid">
        <KpiCard label="Worklist" value={totalActive} tone="accent" />
        <KpiCard label="New leads" value={newToday} tone="hot" />
        <KpiCard label="Updates" value={updatesCount} tone="cool" />
        <KpiCard label="Assigned" value={assignedToMe} tone="muted" />
      </div>

      {/* Busca */}
      <div className="conv-search">
        <input
          placeholder="Buscar por nome ou telefone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Worklist header com filtro dropdown */}
      <div className="worklist-head">
        <button
          type="button"
          className="worklist-toggle"
          onClick={() => setWorklistOpen((v) => !v)}
        >
          <span className="worklist-check">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </span>
          <span className="worklist-title">Worklist</span>
          {filter !== "all" ? (
            <span className="worklist-filter-chip">{FILTER_LABELS[filter]}</span>
          ) : null}
          <svg
            className={`worklist-chevron${worklistOpen ? " open" : ""}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className="filter-dropdown" ref={filterMenuRef}>
          <button
            type="button"
            className="filter-trigger"
            onClick={() => setFilterOpen((v) => !v)}
            title="Filtrar lista"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
          </button>
          {filterOpen ? (
            <div className="filter-menu" role="listbox">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`filter-menu-item${filter === f ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter(f);
                    setFilterOpen(false);
                  }}
                >
                  {FILTER_LABELS[f]}
                  {filter === f ? <span>✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Lista (oculta quando worklist collapsed) */}
      {worklistOpen ? (
        <div className="conv-list">
          {loading && items.length === 0 ? (
            <EmptyState variant="loading" title="Carregando…" />
          ) : items.length === 0 ? (
            <EmptyState title={q ? `Nada para "${q}"` : "Sem conversas"} />
          ) : (
            <>
              {action.map((it) => (
                <ConvListItem key={it.id} item={it} active={it.id === activeId} />
              ))}
              {ia.map((it) => (
                <ConvListItem key={it.id} item={it} active={it.id === activeId} />
              ))}
              {waiting.map((it) => (
                <ConvListItem key={it.id} item={it} active={it.id === activeId} />
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "hot" | "cool" | "muted";
}) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <span className="kpi-label">
        <span className="kpi-dot" />
        {label}
      </span>
      <span className="kpi-value">{value}</span>
    </div>
  );
}
