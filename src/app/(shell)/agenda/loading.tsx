import { Skeleton, SkeletonBlock } from "@/components/ui/Skeleton";
import "./agenda.css";

export default function AgendaLoading() {
  return (
    <main className="page-body agenda-page">
      <header className="agenda-head">
        <div>
          <h1 className="display">
            <Skeleton width={180} height={36} radius={8} />
          </h1>
          <p className="agenda-sub">
            <Skeleton width="60%" height={14} />
          </p>
        </div>
      </header>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 920 }}
        aria-busy="true"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} height={72} />
        ))}
      </div>
    </main>
  );
}
