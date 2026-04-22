"use client";

import Link from "next/link";
import type { InboxItem } from "./types";
import { Avatar } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chip";
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

function metaChips(item: InboxItem): React.ReactNode {
  const chips: React.ReactNode[] = [];

  const pendingHandoff =
    item.handoff_notified_at !== null &&
    !item.bridge_active &&
    !item.handoff_resolved_at;

  // Handoff urgente → chip warm "IA · conf baixa"
  if (pendingHandoff) {
    const label =
      item.handoff_reason
        ? HANDOFF_REASON_LABEL[item.handoff_reason] ?? item.handoff_reason
        : "handoff";
    chips.push(
      <Chip key="handoff" tone="warm" dot>
        {`IA · ${label}`}
      </Chip>,
    );
  }

  // Score alto → chip hot
  if (item.score >= 80) {
    chips.push(
      <Chip key="score" tone="hot" dot>
        {`Quente ${item.score}`}
      </Chip>,
    );
  }

  // Bridge ativa → chip blue-soft
  if (item.bridge_active) {
    chips.push(
      <Chip key="bridge" tone="blue-soft">
        Em atendimento
      </Chip>,
    );
  }

  const q = (item.qualification ?? {}) as Record<string, unknown>;

  // Esfriando — sem mensagem há > 7 dias
  if (item.last_message_at) {
    const days = Math.floor((Date.now() - new Date(item.last_message_at).getTime()) / 86_400_000);
    if (days > 7 && !pendingHandoff) {
      chips.push(
        <Chip key="cold" tone="ghost">
          Esfriando
        </Chip>,
      );
    }
  }

  // Visita agendada
  if (typeof q.visita_agendada === "string" && q.visita_agendada) {
    chips.push(
      <Chip key="visita" tone="blue-soft">
        Visita hoje
      </Chip>,
    );
  }

  return chips.slice(0, 2); // máximo 2 chips para não poluir
}

function lastPreview(item: InboxItem): string {
  const content = item.last_message_content?.slice(0, 80) ?? "(sem mensagens)";
  if (item.last_message_direction === "outbound") {
    return `Você: ${content}`;
  }
  return content;
}

export function ConvListItem({
  item,
  active,
}: {
  item: InboxItem;
  active: boolean;
}) {
  const name = item.full_name ?? item.push_name ?? item.phone;
  const chips = metaChips(item);

  return (
    <Link
      href={`/inbox/${item.id}`}
      className={`conv-item${active ? " active" : ""}`}
    >
      <Avatar name={name} size="md" />
      <div className="info">
        <div className="row1">
          <span className="who">{name}</span>
          <span className="time">{fmtRel(item.last_message_at)}</span>
        </div>
        <div className="prev">{lastPreview(item)}</div>
        {chips && (chips as React.ReactNode[]).length > 0 ? (
          <div className="meta">{chips}</div>
        ) : null}
      </div>
    </Link>
  );
}
