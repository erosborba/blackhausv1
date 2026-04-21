import { Skeleton, SkeletonBlock } from "@/components/ui/Skeleton";
import "./revisao.css";

export default function RevisaoLoading() {
  return (
    <main className="page-body revisao-page">
      <header className="revisao-head">
        <div>
          <h1 className="display">
            <Skeleton width={200} height={36} radius={8} />
          </h1>
          <p className="revisao-sub">
            <Skeleton width="70%" height={14} />
          </p>
        </div>
      </header>
      <div className="revisao-body" aria-busy="true">
        <div className="rev-cards">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} height={90} />
          ))}
        </div>
        <SkeletonBlock height={220} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} height={96} />
          ))}
        </div>
      </div>
    </main>
  );
}
