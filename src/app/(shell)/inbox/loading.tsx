import { SkeletonBlock } from "@/components/ui/Skeleton";
import "@/components/inbox/inbox.css";

/**
 * Loading do /inbox — rail esquerdo com skeletons de item da lista.
 * Mantém o grid 360/1fr pra não reflow quando os dados chegarem.
 */
export default function InboxLoading() {
  return (
    <div className="inbox-shell two-col">
      <aside
        className="priority-rail"
        aria-busy="true"
        aria-label="Carregando lista de conversas"
      >
        <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonBlock key={i} height={72} />
          ))}
        </div>
      </aside>
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--ink-4)", fontSize: 13 }}>Carregando…</span>
      </main>
    </div>
  );
}
