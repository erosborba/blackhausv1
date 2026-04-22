import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { CLEANUP_POLICY } from "@/lib/cleanup";

export type CleanupSnapshot = {
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

export async function loadCleanupSnapshot(): Promise<CleanupSnapshot> {
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
