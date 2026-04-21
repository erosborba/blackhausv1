export type AgendaTab = "hoje" | "follow-ups" | "visitas";

export type FollowUpRowData = {
  id: string;
  lead_id: string;
  step: number;
  scheduled_for: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  message: string | null;
  sent_at: string | null;
  leads: {
    id: string;
    full_name: string | null;
    push_name: string | null;
    phone: string;
    status: string;
    stage: string | null;
    score: number | null;
  } | null;
};
