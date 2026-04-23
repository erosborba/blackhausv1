"use client";

import Link from "next/link";
import type { InboxItem } from "./types";
import { Avatar } from "@/components/ui/Avatar";
import { HANDOFF_REASON_LABEL } from "@/lib/handoff-copy";

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ont.";
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Ação primária + pill de prioridade na base do card. */
function cardFooter(item: InboxItem): {
  action: { icon: "doc" | "phone" | "mail" | "follow"; label: string } | null;
  pill: { label: string; tone: "hot" | "warm" | "cool" | "ok" } | null;
} {
  const pendingHandoff =
    item.handoff_notified_at !== null &&
    !item.bridge_active &&
    !item.handoff_resolved_at;

  let action: { icon: "doc" | "phone" | "mail" | "follow"; label: string } | null = null;
  let pill: { label: string; tone: "hot" | "warm" | "cool" | "ok" } | null = null;

  if (pendingHandoff) {
    const label =
      item.handoff_reason
        ? HANDOFF_REASON_LABEL[item.handoff_reason] ?? item.handoff_reason
        : "Aguardando você";
    action = { icon: "doc", label };
    if (item.handoff_urgency === "alta") pill = { label: "High", tone: "hot" };
    else if (item.handoff_urgency === "media") pill = { label: "Mid", tone: "warm" };
    else pill = { label: "Low", tone: "cool" };
  } else if (item.score >= 80) {
    action = { icon: "doc", label: "Lead quente" };
    pill = { label: "High", tone: "hot" };
  } else if (item.bridge_active) {
    action = { icon: "phone", label: "Em atendimento" };
    pill = { label: "Mid", tone: "warm" };
  } else if (item.last_message_direction === "outbound") {
    action = { icon: "follow", label: "Follow up" };
    pill = { label: "Low", tone: "cool" };
  } else if (item.last_message_content) {
    action = { icon: "mail", label: "Nova mensagem" };
  }

  return { action, pill };
}

function subtitle(item: InboxItem): string {
  const q = (item.qualification ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (q.quartos) parts.push(`${q.quartos} dorms`);
  if (q.bairro) parts.push(String(q.bairro));
  else if (q.cidade) parts.push(String(q.cidade));
  if (parts.length === 0 && item.phone) return item.phone;
  return parts.slice(0, 2).join(" · ");
}

function ActionIcon({ kind }: { kind: "doc" | "phone" | "mail" | "follow" }) {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "phone") {
    return (
      <svg {...props}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72a2 2 0 0 1 1.72 2z" />
      </svg>
    );
  }
  if (kind === "mail") {
    return (
      <svg {...props}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    );
  }
  if (kind === "follow") {
    return (
      <svg {...props}>
        <path d="M3 12h14M13 5l7 7-7 7" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function ConvListItem({
  item,
  active,
}: {
  item: InboxItem;
  active: boolean;
}) {
  const name = item.full_name ?? item.push_name ?? item.phone;
  const sub = subtitle(item);
  const { action, pill } = cardFooter(item);

  return (
    <Link
      href={`/inbox/${item.id}`}
      className={`conv-item${active ? " active" : ""}`}
    >
      <div className="conv-item-top">
        <Avatar name={name} size="md" />
        <div className="conv-item-title">
          <span className="who">{name}</span>
          <span className="conv-item-sub">{sub}</span>
        </div>
        <span className="conv-item-time">{fmtRel(item.last_message_at)}</span>
        <span className="conv-item-arrow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M7 17L17 7M10 7h7v7" />
          </svg>
        </span>
      </div>

      {action ? (
        <div className="conv-item-action">
          <span className="conv-action-icon">
            <ActionIcon kind={action.icon} />
          </span>
          <span className="conv-action-label">{action.label}</span>
          {pill ? (
            <span className={`conv-pill tone-${pill.tone}`}>{pill.label}</span>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}

