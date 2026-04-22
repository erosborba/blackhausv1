import { CLEANUP_POLICY } from "@/lib/cleanup";
import type { CleanupSnapshot } from "@/lib/cleanup-snapshot";

type Health = { label: string; cls: string };

function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "hoje";
  if (days === 1) return "1 dia atrás";
  return `${days} dias atrás`;
}

function actualDays(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

function healthBadge(actual: number | null, policyDays: number): Health {
  if (actual === null) return { label: "vazio", cls: "manut-badge-ok" };
  if (actual > policyDays * 2) return { label: `atrasado (${actual}d)`, cls: "manut-badge-warn" };
  if (actual > policyDays + 2) return { label: `${actual}d`, cls: "manut-badge-amber" };
  return { label: `${actual}d`, cls: "manut-badge-ok" };
}

export function ManutencaoHealthCard({ snapshot }: { snapshot: CleanupSnapshot }) {
  const rows: Array<{ task: string; detail: string; policy: string; current: string; health: Health }> = [
    {
      task: "Drafts no storage",
      detail: "arquivos em draft/{slug}/... do wizard abandonado",
      policy: `> ${CLEANUP_POLICY.DRAFT_STORAGE_DAYS} dias`,
      current: `${snapshot.draftFolders} pasta(s)`,
      health:
        snapshot.draftFolders > 50
          ? { label: "muito acumulado", cls: "manut-badge-amber" }
          : { label: "ok", cls: "manut-badge-ok" },
    },
    {
      task: "ai_usage_log",
      detail: "telemetria de chamadas AI",
      policy: `> ${CLEANUP_POLICY.AI_USAGE_LOG_DAYS} dias`,
      current: `${snapshot.aiUsageCount} linha(s), mais antiga: ${daysAgo(snapshot.aiUsageOldest)}`,
      health: healthBadge(actualDays(snapshot.aiUsageOldest), CLEANUP_POLICY.AI_USAGE_LOG_DAYS),
    },
    {
      task: "copilot_turns",
      detail: "histórico do corretor conversando com a Bia",
      policy: `> ${CLEANUP_POLICY.COPILOT_TURNS_DAYS} dias`,
      current: `${snapshot.copilotCount} linha(s), mais antiga: ${daysAgo(snapshot.copilotOldest)}`,
      health: healthBadge(actualDays(snapshot.copilotOldest), CLEANUP_POLICY.COPILOT_TURNS_DAYS),
    },
    {
      task: "drafts (tabela)",
      detail: "drafts propostos pela Bia (feedback loop usa só os mais recentes)",
      policy: `> ${CLEANUP_POLICY.DRAFTS_TABLE_DAYS} dias`,
      current: `${snapshot.draftsTableCount} linha(s), mais antiga: ${daysAgo(snapshot.draftsTableOldest)}`,
      health: healthBadge(actualDays(snapshot.draftsTableOldest), CLEANUP_POLICY.DRAFTS_TABLE_DAYS),
    },
    {
      task: "follow_ups (terminais)",
      detail: "sent/cancelled/failed (pending é preservado indefinidamente)",
      policy: `> ${CLEANUP_POLICY.FOLLOW_UPS_DAYS} dias`,
      current: `${snapshot.followUpsTerminalCount} linha(s), mais antiga: ${daysAgo(snapshot.followUpsOldest)}`,
      health: healthBadge(actualDays(snapshot.followUpsOldest), CLEANUP_POLICY.FOLLOW_UPS_DAYS),
    },
    {
      task: "handoff_escalations (terminais)",
      detail: "fired/cancelled (pending é preservado pro cron executar)",
      policy: `> ${CLEANUP_POLICY.HANDOFF_ESCALATIONS_DAYS} dias`,
      current: `${snapshot.handoffEscTerminalCount} linha(s), mais antiga: ${daysAgo(snapshot.handoffEscOldest)}`,
      health: healthBadge(actualDays(snapshot.handoffEscOldest), CLEANUP_POLICY.HANDOFF_ESCALATIONS_DAYS),
    },
    {
      task: "Leads inativos (LGPD)",
      detail: `sem mensagem há > ${CLEANUP_POLICY.INACTIVE_LEAD_DAYS}d, não qualificados/agendados/ganhos`,
      policy: `> ${CLEANUP_POLICY.INACTIVE_LEAD_DAYS} dias`,
      current: `${snapshot.inactiveLeadCandidates} candidato(s)`,
      health:
        snapshot.inactiveLeadCandidates > 0
          ? { label: `${snapshot.inactiveLeadCandidates} pendente(s)`, cls: "manut-badge-amber" }
          : { label: "ok", cls: "manut-badge-ok" },
    },
  ];

  return (
    <>
      <h3 className="manut-section-title">Estado atual</h3>
      <table className="manut-table">
        <thead>
          <tr>
            <th>Rotina</th>
            <th>Política</th>
            <th>Estado</th>
            <th>Saúde</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.task}>
              <td>
                <div className="manut-task-name">{r.task}</div>
                <div className="manut-task-detail">{r.detail}</div>
              </td>
              <td>
                <span className="manut-badge">{r.policy}</span>
              </td>
              <td>{r.current}</td>
              <td>
                <span className={`manut-badge ${r.health.cls}`}>{r.health.label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 16 }}>
        Cron dispara <code>POST /api/cron/cleanup</code> 1×/dia. Se &quot;dia(s) atrás&quot; passar
        do limite, confira os secrets <code>APP_URL</code> / <code>CRON_SECRET</code>.
      </p>
    </>
  );
}
