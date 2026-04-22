import { SkeletonBlock } from "@/components/ui/Skeleton";

/**
 * Loading scoped ao `[id]` — só o main pane (thread + context).
 * Rails ficam estáveis porque vivem no layout acima.
 */
export default function InboxThreadLoading() {
  return (
    <>
      <main className="pane" aria-busy="true" aria-label="Carregando conversa">
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBlock height={52} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock
                key={i}
                height={48}
                style={{ width: i % 2 === 0 ? "70%" : "60%", alignSelf: i % 2 === 0 ? "flex-start" : "flex-end" }}
              />
            ))}
          </div>
        </div>
      </main>
      <aside className="pane" aria-busy="true" aria-label="Carregando contexto">
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBlock height={80} />
          <SkeletonBlock height={120} />
          <SkeletonBlock height={160} />
        </div>
      </aside>
    </>
  );
}
