import { SkeletonBlock } from "@/components/ui/Skeleton";
import "@/components/inbox/inbox.css";

export default function InboxLoading() {
  return (
    <div className="inbox-wrap">
      <div className="inbox-shell two-col">
        <div className="pane" aria-busy="true" aria-label="Carregando conversas">
          <div className="pane-head">
            <h3>Conversas</h3>
          </div>
          <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonBlock key={i} height={72} />
            ))}
          </div>
        </div>
        <main style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--ink-4)", fontSize: 13 }}>Carregando…</span>
        </main>
      </div>
    </div>
  );
}
