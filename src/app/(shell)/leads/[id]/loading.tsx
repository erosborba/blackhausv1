import { SkeletonBlock } from "@/components/ui/Skeleton";
import "./leads.css";

export default function LeadLoading() {
  return (
    <main className="page-body lead-page">
      <div className="lead-wrap" aria-busy="true" aria-label="Carregando perfil do lead">
        <SkeletonBlock height={86} />
        <div className="lead-grid">
          <div className="lead-col">
            <SkeletonBlock height={120} />
            <SkeletonBlock height={180} />
            <SkeletonBlock height={240} />
          </div>
          <div className="lead-col">
            <SkeletonBlock height={120} />
            <SkeletonBlock height={200} />
          </div>
        </div>
      </div>
    </main>
  );
}
