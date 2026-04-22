"use client";

import { useState } from "react";
import { Topbar } from "@/components/shell/Topbar";
import { RevisaoTabs } from "@/components/revisao/RevisaoTabs";
import {
  approvalPct,
  type DraftWithRefs,
  type RevisaoStats,
} from "@/components/revisao/types";

type TabKey = "overview" | "pendentes" | "aprendizado";

const WINDOW_DAYS = 30;

/**
 * Shell client que hospeda header + tabs + body. Estado da aba é local —
 * evita roundtrip SSR por clique. URL continua sincronizada via
 * `history.replaceState` pra não quebrar bookmark.
 */
export function RevisaoShell({
  initialTab,
  drafts,
  stats,
  canApprove,
}: {
  initialTab: TabKey;
  drafts: DraftWithRefs[];
  stats: RevisaoStats;
  canApprove: boolean;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const overallPct = approvalPct(stats);

  function switchTab(next: TabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.toString());
  }

  return (
    <>
      <Topbar crumbs={[{ label: "Revisão" }, { label: tabLabel(tab) }]} />
      <main className="page-body revisao-page">
        <header className="revisao-head">
          <div>
            <h1 className="display">Revisão</h1>
            <p className="revisao-sub">
              Drafts propostos pela Bia nos últimos {WINDOW_DAYS} dias.{" "}
              {stats.total} propostas
              {overallPct != null ? ` · ${overallPct}% aprovados sem edição` : ""}.
            </p>
          </div>
          <div className="revisao-tabs-nav">
            <TabBtn active={tab === "overview"} onClick={() => switchTab("overview")}>
              Overview
            </TabBtn>
            <TabBtn active={tab === "pendentes"} onClick={() => switchTab("pendentes")}>
              Pendentes
              {stats.proposed > 0 ? (
                <span className="tab-badge">{stats.proposed}</span>
              ) : null}
            </TabBtn>
            <TabBtn active={tab === "aprendizado"} onClick={() => switchTab("aprendizado")}>
              Aprendizado
            </TabBtn>
          </div>
        </header>

        <RevisaoTabs tab={tab} drafts={drafts} stats={stats} canApprove={canApprove} />
      </main>
    </>
  );
}

function tabLabel(t: TabKey): string {
  if (t === "pendentes") return "Pendentes";
  if (t === "aprendizado") return "Aprendizado";
  return "Overview";
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`revisao-tab ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
