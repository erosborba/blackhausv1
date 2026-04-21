import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_HINT,
  PIPELINE_STAGE_LABEL,
  getPipelineBoard,
  type PipelineLead,
  type PipelineStage,
} from "@/lib/pipeline";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import "./pipeline.css";

export const dynamic = "force-dynamic";

/**
 * /pipeline — kanban por stage da Bia. Arrastar um card entre colunas
 * chama /api/pipeline/move, que grava stage_change no lead_events (trilha
 * pro /inbox timeline).
 *
 * Stages canônicas vêm de `PIPELINE_STAGES`. Leads com stage fora dessa
 * lista (ou null) aparecem numa coluna extra "—".
 */
export default async function PipelinePage() {
  const role = await getCurrentRole();
  if (!can(role, "pipeline.view")) redirect("/brief");
  const canMove = can(role, "pipeline.move_stage");

  const board = await getPipelineBoard(50);

  // Ordena colunas: canônicas primeiro (em ordem), depois "outras" (que o
  // backend pode ter inserido — stage custom ou '—').
  const canonical = new Set<string>(PIPELINE_STAGES);
  const extraStages = board.counts
    .map((c) => c.stage)
    .filter((s) => !canonical.has(s));

  const columns = [
    ...PIPELINE_STAGES.map((s): { stage: string; label: string; hint: string; leads: PipelineLead[]; count: number } => ({
      stage: s,
      label: PIPELINE_STAGE_LABEL[s as PipelineStage],
      hint: PIPELINE_STAGE_HINT[s as PipelineStage],
      leads: board.byStage[s] ?? [],
      count: board.counts.find((c) => c.stage === s)?.count ?? 0,
    })),
    ...extraStages.map((s) => ({
      stage: s,
      label: s === "—" ? "Sem estágio" : s,
      hint: "",
      leads: board.byStage[s] ?? [],
      count: board.counts.find((c) => c.stage === s)?.count ?? 0,
    })),
  ];

  return (
    <>
      <Topbar crumbs={[{ label: "Pipeline" }]} />
      <main className="page-body pipeline-page">
        <header className="pipeline-head">
          <div>
            <h1 className="display">Pipeline</h1>
            <p className="pipeline-sub">
              Onde cada lead está na jornada da Bia. Arraste pra corrigir o
              estágio — isso fica na timeline do lead.
            </p>
          </div>
        </header>

        <PipelineBoard columns={columns} canMove={canMove} />
      </main>
    </>
  );
}
