import { SkeletonBlock } from "@/components/ui/Skeleton";
import "./pipeline.css";

export default function PipelineLoading() {
  return (
    <main className="page-body pipeline-page">
      <div
        style={{
          display: "grid",
          gridAutoFlow: "column",
          gridAutoColumns: "minmax(260px, 1fr)",
          gap: 12,
          padding: "16px 24px",
        }}
        aria-busy="true"
      >
        {Array.from({ length: 6 }).map((_, col) => (
          <div key={col} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SkeletonBlock height={32} />
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} height={90} />
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
