import { notFound, redirect } from "next/navigation";
import { getCurrentRole } from "@/lib/auth/role-server";
import { Topbar } from "@/components/shell/Topbar";
import { supabaseAdmin } from "@/lib/supabase";
import { getLatestFeedback, listFeedback } from "@/lib/handoff-feedback";
import type { Lead } from "@/lib/leads";
import type { ThreadMessage } from "@/components/inbox/types";
import type { DraftRow } from "@/lib/drafts";
import { HandoffReview } from "./HandoffReview";
import "@/components/inbox/inbox.css";
import "./handoff.css";

export const dynamic = "force-dynamic";

/**
 * /handoff/[leadId] — revisão de escalação.
 *
 * Layout: 2 colunas (thread compacta + rascunho | decision panel).
 * Corretor vê o que a Bia sugeriu ("diff rascunho" proposed → final se
 * editou) + motivo/urgência do escalamento, decide se foi bom timing
 * e opcionalmente promove a Q&A pro FAQ do empreendimento.
 */
export default async function HandoffReviewPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const role = await getCurrentRole();
  if (role !== "admin" && role !== "corretor") redirect("/brief");

  const { leadId } = await params;
  const sb = supabaseAdmin();

  const [leadRes, msgsRes, draftRes, empsRes, latestFb, fbHistory] =
    await Promise.all([
      sb.from("leads").select("*").eq("id", leadId).maybeSingle(),
      sb
        .from("messages")
        .select("id, role, direction, content, created_at, sources")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(30),
      sb
        .from("drafts")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("empreendimentos")
        .select("id, nome, slug")
        .order("nome", { ascending: true }),
      getLatestFeedback(leadId),
      listFeedback(leadId),
    ]);

  if (!leadRes.data) notFound();
  const lead = leadRes.data as Lead;
  const messages = ((msgsRes.data ?? []) as ThreadMessage[]).slice().reverse();
  const draft = (draftRes.data as DraftRow | null) ?? null;
  const empreendimentos = (empsRes.data ?? []) as Array<{
    id: string;
    nome: string;
    slug: string | null;
  }>;
  const name = lead.full_name ?? lead.push_name ?? lead.phone;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "Inbox", href: "/inbox" },
          { label: name, href: `/inbox/${lead.id}` },
          { label: "Handoff" },
        ]}
      />
      <main className="page-body handoff-page">
        <HandoffReview
          lead={lead}
          messages={messages}
          draft={draft}
          empreendimentos={empreendimentos}
          latestFeedback={latestFb}
          feedbackHistory={fbHistory}
        />
      </main>
    </>
  );
}
