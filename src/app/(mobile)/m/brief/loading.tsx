import { SkeletonBlock, Skeleton } from "@/components/ui/Skeleton";

export default function MobileBriefLoading() {
  return (
    <>
      <h1 className="m-page-title">
        <Skeleton width={160} height={26} radius={6} />
      </h1>
      <p className="m-page-sub">
        <Skeleton width="80%" height={13} />
      </p>
      <div className="m-kpi-grid" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} height={76} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} height={100} />
        ))}
      </div>
    </>
  );
}
