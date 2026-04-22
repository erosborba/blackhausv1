"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { InboxItem } from "./types";
import { Avatar } from "@/components/ui/Avatar";

/**
 * Priority rail horizontal — topo do inbox cockpit.
 * Classifica até 4 leads salientes + card de overflow.
 * - hot   : handoff urgente (urgency=alta) ou score >= 85
 * - warm  : handoff pendente (não escalado) ou IA com baixa confiança
 * - cool  : visita agendada / próxima ação confirmada (bridge ativa)
 * - neutral: esfriando (sem msg há >7 dias)
 */

type RailLead = {
  item: InboxItem;
  variant: "hot" | "warm" | "cool" | "";
  tag: string;
  sub: string;
};

function classifyItems(items: InboxItem[]): { featured: RailLead[]; overflowCount: number } {
  const featured: RailLead[] = [];

  for (const item of items) {
    if (featured.length >= 4) break;

    const pendingHandoff =
      item.handoff_notified_at !== null &&
      !item.bridge_active &&
      !item.handoff_resolved_at;
    const q = (item.qualification ?? {}) as Record<string, unknown>;
    // Sub-texto: resumo do interesse se qualificado; senão última mensagem
    const quartos = typeof q.quartos === "number" ? `${q.quartos} dorms` : null;
    const bairro =
      typeof q.bairro === "string"
        ? q.bairro
        : Array.isArray(q.bairros) && q.bairros.length > 0
          ? String((q.bairros as unknown[])[0])
          : null;
    const interessePreview = [quartos, bairro].filter(Boolean).join(" · ") || null;
    const sub = interessePreview ?? item.last_message_content?.slice(0, 60) ?? "sem dados";

    // Hot: handoff urgente OU score altíssimo
    if (pendingHandoff && item.handoff_urgency === "alta" && !featured.find((f) => f.item.id === item.id)) {
      const reason = item.handoff_reason ?? "handoff";
      featured.push({ item, variant: "hot", tag: `ALTA · ${reason.toUpperCase()}`, sub });
      continue;
    }
    if (item.score >= 85 && !featured.find((f) => f.item.id === item.id)) {
      featured.push({ item, variant: "hot", tag: `ALTA · QUENTE ${item.score}`, sub });
      continue;
    }

    // Warm: handoff pendente (urgência normal) — IA pediu ajuda
    if (pendingHandoff && !featured.find((f) => f.item.id === item.id)) {
      featured.push({
        item,
        variant: "warm",
        tag: `IA PEDIU AJUDA`,
        sub: `${sub} · conf baixa`,
      });
      continue;
    }

    // Cool: bridge ativa — corretor em conversa ou visita próxima
    if (item.bridge_active && !featured.find((f) => f.item.id === item.id)) {
      featured.push({ item, variant: "cool", tag: "EM ATENDIMENTO", sub });
      continue;
    }

    // Neutral: score 40-84 sem outra urgência
    if (item.score >= 40 && !featured.find((f) => f.item.id === item.id)) {
      const daysSince = item.last_message_at
        ? Math.floor((Date.now() - new Date(item.last_message_at).getTime()) / 86_400_000)
        : null;
      const tag = daysSince !== null && daysSince > 7 ? `ESFRIANDO · ${daysSince}d` : "MORNO";
      featured.push({ item, variant: "", tag, sub });
    }
  }

  const overflowCount = Math.max(0, items.filter((it) => it.score >= 40).length - featured.length);
  return { featured, overflowCount };
}

function fmtName(item: InboxItem) {
  return item.full_name ?? item.push_name ?? item.phone;
}

function useActiveLeadId(): string | null {
  const pathname = usePathname();
  const m = pathname?.match(/^\/inbox\/([^/]+)/);
  return m ? m[1] : null;
}

export function InboxRail({ items }: { items: InboxItem[] }) {
  const activeId = useActiveLeadId();
  const { featured, overflowCount } = classifyItems(items);

  if (featured.length === 0) return null;

  return (
    <div className="inbox-rail-top">
      {featured.map(({ item, variant, tag, sub }) => (
        <Link
          key={item.id}
          href={`/inbox/${item.id}`}
          className={`rail-card${variant ? ` ${variant}` : ""}${item.id === activeId ? " active" : ""}`}
        >
          <div className="row1">
            <span className="rail-tag">{tag}</span>
            <span className={`dot${variant ? ` ${variant}` : " muted"}`} />
          </div>
          <div className="rail-who">
            <Avatar name={fmtName(item)} size="sm" />
            <span className="rail-name">{fmtName(item)}</span>
          </div>
          <div className="rail-sub">{sub}</div>
        </Link>
      ))}

      {overflowCount > 0 ? (
        <Link href="/inbox" className="rail-card overflow">
          <div className="rail-tag">+ {overflowCount} LEADS</div>
          <div className="rail-sub">em espera</div>
        </Link>
      ) : null}
    </div>
  );
}
