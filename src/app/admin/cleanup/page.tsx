import type { CSSProperties } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { CLEANUP_POLICY } from "@/lib/cleanup";
import { CleanupRunner } from "./runner-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /admin/cleanup — operações de manutenção.
 *
 * Não guardamos histórico de execuções; em vez disso mostramos o "estado
 * atual" — quão antigo é o dado mais velho em cada tabela/bucket. Se o
 * cron estiver rodando direito, os números ficam colados no cutoff da
 * policy. Se "divergirem" muito (ex.: ai_usage_log com 60 dias quando a
 * policy é 30), é sinal que o cron não rodou.
 */

type StateSnapshot = {
  aiUsageOldest: string | null;
  aiUsageCount: number;
  copilotOldest: string | null;
  copilotCount: number;
  draftsTableOldest: string | null;
  draftsTableCount: number;
  followUpsOldest: string | null;
  followUpsTerminalCount: number;
  handoffEscOldest: string | null;
  handoffEscTerminalCount: number;
  draftFolders: number;
  inactiveLeadCandidates: number;
};

async function loadState(): Promise<StateSnapshot> {
  const sb = supabaseAdmin();
  const inactiveCutoff = new Date(
    Date.now() - CLEANUP_POLICY.INACTIVE_LEAD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    aiOldestQ,
    aiCountQ,
    cpOldestQ,
    cpCountQ,
    dtOldestQ,
    dtCountQ,
    fuOldestQ,
    fuCountQ,
    heOldestQ,
    heCountQ,
    draftsQ,
    inactiveQ,
  ] = await Promise.all([
    sb.from("ai_usage_log").select("created_at").order("created_at", { ascending: true }).limit(1),
    sb.from("ai_usage_log").select("*", { count: "exact", head: true }),
    sb.from("copilot_turns").select("created_at").order("created_at", { ascending: true }).limit(1),
    sb.from("copilot_turns").select("*", { count: "exact", head: true }),
    sb.from("drafts").select("created_at").order("created_at", { ascending: true }).limit(1),
    sb.from("drafts").select("*", { count: "exact", head: true }),
    // Só rows terminais (pending não é candidato a cleanup).
    sb
      .from("follow_ups")
      .select("created_at")
      .neq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1),
    sb
      .from("follow_ups")
      .select("*", { count: "exact", head: true })
      .neq("status", "pending"),
    sb
      .from("handoff_escalations")
      .select("created_at")
      .neq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1),
    sb
      .from("handoff_escalations")
      .select("*", { count: "exact", head: true })
      .neq("status", "pending"),
    sb.storage.from("empreendimentos").list("draft", { limit: 1000 }),
    sb
      .from("leads")
      .select("*", { count: "exact", head: true })
      .or(`last_message_at.lt.${inactiveCutoff},last_message_at.is.null`)
      .not("status", "in", "(qualified,scheduled,won)")
      .eq("bridge_active", false)
      .lt("created_at", inactiveCutoff),
  ]);

  return {
    aiUsageOldest: aiOldestQ.data?.[0]?.created_at ?? null,
    aiUsageCount: aiCountQ.count ?? 0,
    copilotOldest: cpOldestQ.data?.[0]?.created_at ?? null,
    copilotCount: cpCountQ.count ?? 0,
    draftsTableOldest: dtOldestQ.data?.[0]?.created_at ?? null,
    draftsTableCount: dtCountQ.count ?? 0,
    followUpsOldest: fuOldestQ.data?.[0]?.created_at ?? null,
    followUpsTerminalCount: fuCountQ.count ?? 0,
    handoffEscOldest: heOldestQ.data?.[0]?.created_at ?? null,
    handoffEscTerminalCount: heCountQ.count ?? 0,
    draftFolders: draftsQ.data?.length ?? 0,
    inactiveLeadCandidates: inactiveQ.count ?? 0,
  };
}

function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "hoje";
  if (days === 1) return "1 dia atrás";
  return `${days} dias atrás`;
}

function healthBadge(actualDays: number | null, policyDays: number): { label: string; style: CSSProperties } {
  if (actualDays === null) return { label: "vazio", style: badgeOk };
  // 2x a policy = cron provavelmente não rodou
  if (actualDays > policyDays * 2) return { label: `atrasado (${actualDays}d)`, style: badgeWarn };
  if (actualDays > policyDays + 2) return { label: `${actualDays}d`, style: badgeAmber };
  return { label: `${actualDays}d`, style: badgeOk };
}

function actualDays(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// ── Estilos ──
const container: CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "32px 20px" };
const headerRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 20,
};
const backLink: CSSProperties = { color: "#8f8f9a", textDecoration: "none", fontSize: 13 };
const policyCard: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  padding: "18px 20px",
  marginBottom: 24,
};
const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
};
const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8f8f9a",
  borderBottom: "1px solid #2a2a32",
  background: "#121217",
};
const td: CSSProperties = {
  padding: "12px 14px",
  fontSize: 13,
  borderBottom: "1px solid #20202a",
  verticalAlign: "middle",
};
const badgeBase: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  border: "1px solid #2a2a32",
};
const badgeOk: CSSProperties = { ...badgeBase, background: "#1a2a1e", color: "#7ee19e", borderColor: "#2a4a32" };
const badgeAmber: CSSProperties = { ...badgeBase, background: "#2a241a", color: "#e1c07e", borderColor: "#4a3c2a" };
const badgeWarn: CSSProperties = { ...badgeBase, background: "#3a1f23", color: "#ff9fa8", borderColor: "#5a2a30" };
const sectionTitle: CSSProperties = {
  fontSize: 13,
  color: "#8f8f9a",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "28px 0 10px 2px",
};

export default async function CleanupPage() {
  const state = await loadState();

  const rows = [
    {
      task: "Drafts no storage",
      detail: `arquivos em draft/{slug}/... do wizard abandonado`,
      policy: `> ${CLEANUP_POLICY.DRAFT_STORAGE_DAYS} dias`,
      current: `${state.draftFolders} pasta(s)`,
      health: state.draftFolders > 50 ? { label: "muito acumulado", style: badgeAmber } : { label: "ok", style: badgeOk },
    },
    {
      task: "ai_usage_log",
      detail: "telemetria de chamadas AI",
      policy: `> ${CLEANUP_POLICY.AI_USAGE_LOG_DAYS} dias`,
      current: `${state.aiUsageCount} linha(s), mais antiga: ${daysAgo(state.aiUsageOldest)}`,
      health: healthBadge(actualDays(state.aiUsageOldest), CLEANUP_POLICY.AI_USAGE_LOG_DAYS),
    },
    {
      task: "copilot_turns",
      detail: "histórico do corretor conversando com a Bia",
      policy: `> ${CLEANUP_POLICY.COPILOT_TURNS_DAYS} dias`,
      current: `${state.copilotCount} linha(s), mais antiga: ${daysAgo(state.copilotOldest)}`,
      health: healthBadge(actualDays(state.copilotOldest), CLEANUP_POLICY.COPILOT_TURNS_DAYS),
    },
    {
      task: "drafts (tabela)",
      detail: "drafts propostos pela Bia (feedback loop usa só os mais recentes)",
      policy: `> ${CLEANUP_POLICY.DRAFTS_TABLE_DAYS} dias`,
      current: `${state.draftsTableCount} linha(s), mais antiga: ${daysAgo(state.draftsTableOldest)}`,
      health: healthBadge(actualDays(state.draftsTableOldest), CLEANUP_POLICY.DRAFTS_TABLE_DAYS),
    },
    {
      task: "follow_ups (terminais)",
      detail: "sent/cancelled/failed (pending é preservado indefinidamente)",
      policy: `> ${CLEANUP_POLICY.FOLLOW_UPS_DAYS} dias`,
      current: `${state.followUpsTerminalCount} linha(s), mais antiga: ${daysAgo(state.followUpsOldest)}`,
      health: healthBadge(actualDays(state.followUpsOldest), CLEANUP_POLICY.FOLLOW_UPS_DAYS),
    },
    {
      task: "handoff_escalations (terminais)",
      detail: "fired/cancelled (pending é preservado pro cron executar)",
      policy: `> ${CLEANUP_POLICY.HANDOFF_ESCALATIONS_DAYS} dias`,
      current: `${state.handoffEscTerminalCount} linha(s), mais antiga: ${daysAgo(state.handoffEscOldest)}`,
      health: healthBadge(actualDays(state.handoffEscOldest), CLEANUP_POLICY.HANDOFF_ESCALATIONS_DAYS),
    },
    {
      task: "Leads inativos (LGPD)",
      detail: `sem mensagem há > ${CLEANUP_POLICY.INACTIVE_LEAD_DAYS}d, não qualificados/agendados/ganhos`,
      policy: `> ${CLEANUP_POLICY.INACTIVE_LEAD_DAYS} dias`,
      current: `${state.inactiveLeadCandidates} candidato(s)`,
      health: state.inactiveLeadCandidates > 0
        ? { label: `${state.inactiveLeadCandidates} pendente(s)`, style: badgeAmber }
        : { label: "ok", style: badgeOk },
    },
  ];

  return (
    <div style={container}>
      <div style={headerRow}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Manutenção</h1>
          <p style={{ color: "#8f8f9a", fontSize: 13, margin: "4px 0 0" }}>
            Rotinas de limpeza automática. Cron roda todo dia às 02h (BRT).
          </p>
        </div>
        <Link href="/admin" style={backLink}>
          ← admin
        </Link>
      </div>

      <div style={policyCard}>
        <div style={{ fontSize: 13, color: "#8f8f9a", marginBottom: 12 }}>
          <strong style={{ color: "#e7e7ea" }}>Como funciona:</strong> GitHub Actions dispara{" "}
          <code>POST /api/cron/cleanup</code> 1×/dia (workflow{" "}
          <code>.github/workflows/cleanup-cron.yml</code>) e apaga dados fora da policy. Se o
          indicador "dia(s) atrás" passar muito do limite, o cron não rodou — confira os secrets{" "}
          <code>APP_URL</code> / <code>CRON_SECRET</code> no GitHub e no Railway.
        </div>
        <CleanupRunner />
      </div>

      <h2 style={sectionTitle}>Estado atual</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Rotina</th>
            <th style={th}>Política</th>
            <th style={th}>Estado</th>
            <th style={th}>Saúde</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.task}>
              <td style={td}>
                <div style={{ fontWeight: 500 }}>{r.task}</div>
                <div style={{ color: "#8f8f9a", fontSize: 11, marginTop: 2 }}>{r.detail}</div>
              </td>
              <td style={td}>
                <span style={badgeBase}>{r.policy}</span>
              </td>
              <td style={td}>{r.current}</td>
              <td style={td}>
                <span style={r.health.style}>{r.health.label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: "#8f8f9a", fontSize: 12, marginTop: 16 }}>
        Policies definidas em <code>src/lib/cleanup.ts</code> (<code>CLEANUP_POLICY</code>).
      </p>
    </div>
  );
}
