"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { InboxRail } from "@/components/inbox/Rail";
import { PriorityRail } from "@/components/inbox/PriorityRail";
import type { InboxItem } from "@/components/inbox/types";

/**
 * Wrapper client do inbox — decide entre grid 2-col (lista vazia) e 3-col
 * (thread + context) com base no pathname. Fica client só pra poder
 * consultar `usePathname`; o fetch de `items` vem do layout server.
 */
export function InboxLayoutShell({
  items,
  children,
}: {
  items: InboxItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isThread = /^\/inbox\/[^/]+/.test(pathname ?? "");
  const shellClass = isThread ? "inbox-shell" : "inbox-shell two-col";

  return (
    <div className="inbox-wrap">
      <InboxRail items={items} />
      <div className={shellClass}>
        <PriorityRail initial={items} />
        {children}
      </div>
    </div>
  );
}
