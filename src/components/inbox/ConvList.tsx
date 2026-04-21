"use client";

import Link from "next/link";
import type { InboxItem } from "./types";
import { Avatar } from "@/components/ui/Avatar";
import { HANDOFF_URGENCY_EMOJI } from "@/lib/handoff-copy";

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function scoreTone(score: number): "hot" | "warm" | "strong" | "" {
  if (score >= 75) return "hot";
  if (score >= 50) return "strong";
  if (score >= 25) return "warm";
  return "";
}

function priorityTone(item: InboxItem): "hot" | "warm" | "cool" | "idle" {
  // Hot: handoff pendente + urgência alta ou score >= 80
  const pendingHandoff =
    item.handoff_notified_at !== null && !item.bridge_active;
  if (pendingHandoff && item.handoff_urgency === "alta") return "hot";
  if (item.score >= 80) return "hot";
  if (pendingHandoff) return "warm";
  if (item.score >= 50) return "cool";
  return "idle";
}

export function ConvListItem({
  item,
  active,
}: {
  item: InboxItem;
  active: boolean;
}) {
  const name = item.full_name || item.push_name || item.phone;
  const last = item.last_message_content?.slice(0, 80) || "(sem mensagens)";
  const pend =
    item.handoff_notified_at !== null && !item.bridge_active
      ? item.handoff_urgency
      : null;
  const tone = scoreTone(item.score);

  return (
    <Link
      href={`/inbox/${item.id}`}
      className={`conv-item${active ? " active" : ""}`}
      data-active={active}
    >
      <Avatar name={name} size="md" />
      <div className="conv-body">
        <div className="conv-name">
          <span className={`priority-dot ${priorityTone(item)}`} />
          {name}
        </div>
        <div className="conv-last">
          {item.last_message_direction === "outbound" ? "✓ " : ""}
          {last}
        </div>
      </div>
      <div className="conv-meta">
        <span className="conv-time">{fmtRel(item.last_message_at)}</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {pend ? (
            <span style={{ fontSize: 11 }}>{HANDOFF_URGENCY_EMOJI[pend]}</span>
          ) : null}
          <span className={`score-mini ${tone}`}>{item.score}</span>
        </div>
      </div>
    </Link>
  );
}
