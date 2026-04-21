import type { HandoffReason, HandoffUrgency } from "@/lib/handoff-copy";

/** Item da lista de conversas (inbox_items RPC — migration 20260420000011). */
export type InboxItem = {
  id: string;
  phone: string;
  push_name: string | null;
  full_name: string | null;
  status: string;
  stage: string | null;
  qualification: Record<string, unknown> | null;
  agent_notes: string | null;
  human_takeover: boolean;
  last_message_at: string | null;
  last_message_content: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  handoff_reason: HandoffReason | null;
  handoff_urgency: HandoffUrgency | null;
  handoff_notified_at: string | null;
  bridge_active: boolean | null;
  score: number;
  score_updated_at: string | null;
};

/** Fonte citada no retrieval que gerou a mensagem (messages.sources). */
export type MessageSource = {
  kind: "semantic" | "filter";
  empreendimentoId: string;
  slug: string | null;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  score: number | null;
};

/** Mensagem individual na thread do /inbox/[id]. */
export type ThreadMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  direction: "inbound" | "outbound";
  content: string;
  created_at: string;
  media_type: "audio" | "image" | "video" | null;
  media_path: string | null;
  media_mime: string | null;
  media_duration_ms: number | null;
  sources: MessageSource[] | null;
};

export type TimelineEvent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  actor: string | null;
  at: string;
};

export type SuggestedAction = {
  label: string;
  body: string;
  tone: "warm" | "direct" | "pragmatic";
  confidence: "alta" | "media" | "baixa";
};
