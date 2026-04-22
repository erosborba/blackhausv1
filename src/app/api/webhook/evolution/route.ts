import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { jidToPhone, sendPresence, sendText } from "@/lib/evolution";
import { appendMessage, updateLead, upsertLead, type Lead } from "@/lib/leads";
import { runSDR } from "@/agent/graph";
import { scheduleInbound } from "@/lib/debounce";
import { generateBrief } from "@/lib/brief";
import { refreshLeadMemoryAsync } from "@/lib/lead-memory";
import { getAgentByPhone, isAgentPhone } from "@/lib/agents";
import {
  closeBridge,
  forwardToAgent,
  forwardToLead,
  initiateHandoff,
  leadIdFromRef,
  openBridge,
  parseLeadRefFromQuote,
  recoverHandoffEscalations,
} from "@/lib/handoff";
import { brokerCopilot } from "@/lib/copilot";
import {
  sendEmpreendimentoBooking,
  sendEmpreendimentoFotos,
} from "@/agent/tools";
import { findLatestProposed, markDraftActed, recordDraft } from "@/lib/drafts";
import { supabaseAdmin } from "@/lib/supabase";
import { cancelFollowUpsForLead } from "@/lib/follow-ups";
import {
  describeImage,
  detectMedia,
  downloadFromEvolution,
  enforceMaxSize,
  transcribeAudio,
  uploadMedia,
  type DetectedMedia,
} from "@/lib/media";
import { getSetting } from "@/lib/settings";
import { emitLeadEvent } from "@/lib/lead-events";
import { sendOutboundReply } from "@/lib/tts-outbound";
import { take as takeRate } from "@/lib/rate-limit";

// Leaky bucket por remoteJid. Protege contra loops (Evolution reenviando)
// e contra secret vazado. Burst de 20 msgs, reabastece 30/min — humano
// raramente passa disso mesmo digitando fragmentado.
const WEBHOOK_RATE = { capacity: 20, refillPerMinute: 30 } as const;

const HELP_TEXT = `👋 Comandos:
• Responder (quote) uma notificação/mensagem minha → eu repasso pro lead.
• /lead <telefone> <mensagem> — envia pro lead sem precisar de quote.
• /lead <telefone> — abre sessão (sem enviar nada ainda).
• /status — lista seus leads atribuídos.
• /fim — encerra a ponte aberta.
• /help — este menu.

Texto solto (sem quote, sem comando) fica comigo no modo copiloto: te ajudo com contexto, sugestões, resumos dos seus leads.`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do Evolution API.
 *
 * Roteamento:
 *  1. Se o remetente é um corretor cadastrado em `agents`, vai pro fluxo
 *     de ponte (responde a lead, /fim, /lead <id>, /status).
 *  2. Se é lead com `bridge_active`, encaminhamos pro corretor (sem LLM).
 *  3. Se é lead com `human_takeover`, ignoramos (corretor vai responder pelo admin).
 *  4. Caso contrário, roda o agente (debounce + LLM).
 *
 * Segurança: `apikey` header precisa bater com EVOLUTION_WEBHOOK_SECRET ou
 * EVOLUTION_API_KEY.
 */
export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get("apikey") ?? req.headers.get("x-webhook-secret");
  const validSecrets = [env.EVOLUTION_WEBHOOK_SECRET, env.EVOLUTION_API_KEY].filter(Boolean);
  if (!secretHeader || !validSecrets.includes(secretHeader)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Restaura timers de escalação pendentes após restart (idempotente)
  recoverHandoffEscalations().catch((e) =>
    console.error("[webhook] recoverHandoffEscalations", e),
  );

  const event: string | undefined = payload?.event ?? payload?.type;
  const data = payload?.data ?? payload;

  if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const items: any[] = Array.isArray(data) ? data : [data];

  queueMicrotask(() => processMessages(items).catch((e) => console.error("[webhook] processMessages", e)));
  return NextResponse.json({ ok: true });
}

async function processMessages(items: any[]) {
  for (const it of items) {
    try {
      await handleOne(it);
    } catch (e) {
      console.error("[webhook] handleOne error:", e);
    }
  }
}

function extractText(message: any): string {
  if (!message) return "";
  if (typeof message === "string") return message;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ""
  );
}

/**
 * Texto da mensagem citada (quando o usuário usa "Responder" no WhatsApp).
 *
 * O shape muda por versão de Evolution/Baileys. No nosso (Evolution v2.3.7 +
 * WHATSAPP-BAILEYS), o quote mais comum vem em `item.contextInfo.quotedMessage`
 * (root do item). Em outras versões vai pra `message.extendedTextMessage.contextInfo`.
 * A gente tenta todos os locais conhecidos — primeiro que bater ganha.
 */
function extractQuotedText(message: any, item?: any): string | null {
  const candidates = [
    item?.contextInfo, // Evolution v2 com conversation + contextInfo no root do item
    message?.extendedTextMessage?.contextInfo, // shape "clássico" do Baileys
    message?.contextInfo,
    message?.messageContextInfo?.quotedMessage ? message?.messageContextInfo : null,
    item?.message?.contextInfo,
  ];
  for (const ctx of candidates) {
    const quoted = ctx?.quotedMessage;
    if (quoted) return extractText(quoted) || null;
  }
  return null;
}

async function handleOne(it: any) {
  const key = it?.key ?? it?.message?.key;
  const message = it?.message ?? it;
  const fromMe: boolean = key?.fromMe ?? false;
  const remoteJid: string | undefined = key?.remoteJid;
  const messageId: string | undefined = key?.id;
  const pushName: string | undefined = it?.pushName ?? it?.message?.pushName;

  if (fromMe || !remoteJid) return;
  if (remoteJid.endsWith("@g.us")) return;

  // Idempotência: se já processamos esse evolution_message_id, ignora.
  // Protege contra webhook firando em dobro (ex.: global + per-instance no Evolution,
  // retries da fila, ou dois hosts respondendo simultaneamente durante dev).
  if (messageId) {
    const sb = supabaseAdmin();
    const { data: existing } = await sb
      .from("messages")
      .select("id")
      .eq("evolution_message_id", messageId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log("[webhook] dedup: messageId já processado, ignorando", { messageId });
      return;
    }
  }

  // Rate limit por remoteJid — roda DEPOIS do dedup pra não consumir
  // token em reenvios idênticos do Evolution (são ruído, não spam).
  const rate = takeRate(`evolution:${remoteJid}`, WEBHOOK_RATE);
  if (!rate.allowed) {
    console.warn("[webhook] rate-limited", {
      remoteJid,
      retryAfterMs: rate.retryAfterMs,
    });
    return;
  }

  const innerMessage = message?.message ?? message;
  const initialText = extractText(innerMessage);
  const quotedText = extractQuotedText(innerMessage, it);

  // ── Pré-processamento de mídia (áudio/imagem) ──
  // Se áudio: transcrição vira o texto. Se imagem: descrição + caption vira
  // o texto. Se ambos falharem, o auto-reply cuida — não vai pro agent.
  const detected = detectMedia(innerMessage);
  let text = initialText;
  let mediaInfo: MediaProcessResult | null = null;
  if (detected && messageId) {
    mediaInfo = await processIncomingMedia({
      evolutionMessageId: messageId,
      detected,
    });
    if (mediaInfo.text) text = mediaInfo.text;
  }

  if (!text || text.trim().length === 0) {
    if (mediaInfo?.fallbackReply) {
      await dispatchMediaFallback({
        it,
        innerMessage,
        pushName,
        mediaInfo,
        evolutionMessageId: messageId,
      });
    }
    return;
  }

  // Resolve @lid → JID real.
  let realJid: string = remoteJid;
  if (remoteJid.endsWith("@lid")) {
    const resolved =
      key?.remoteJidAlt ||
      key?.senderPn ||
      key?.participantPn ||
      it?.senderPn ||
      it?.sender ||
      it?.participant;
    if (resolved) realJid = resolved;
    else console.warn("[webhook] @lid não resolvido, usando LID:", JSON.stringify(it).slice(0, 2000));
  }
  const phone = jidToPhone(realJid);
  if (!phone || phone.length < 8) {
    console.warn("[webhook] phone inválido:", { remoteJid, realJid, phone });
    return;
  }
  const sendTarget = realJid.endsWith("@lid") ? realJid : phone;

  const agentHit = await isAgentPhone(phone);
  console.log("[webhook] inbound", {
    phone,
    remoteJid,
    realJid,
    isAgent: agentHit,
    hasQuote: Boolean(quotedText),
    quotedPreview: quotedText?.slice(0, 80) ?? null,
    textPreview: text.slice(0, 80),
  });

  // ── Rota 1: corretor ──
  if (agentHit) {
    await handleAgentMessage({ phone, text, quotedText, sendTarget });
    return;
  }

  // ── Rota 2/3/4: lead ──
  const lead = await upsertLead(phone, pushName);

  await appendMessage({
    leadId: lead.id,
    direction: "inbound",
    role: "user",
    content: text,
    evolutionMessageId: messageId,
    evolutionEvent: it,
    mediaType: mediaInfo?.type ?? null,
    mediaPath: mediaInfo?.path ?? null,
    mediaMime: mediaInfo?.mime ?? null,
    mediaDurationMs: mediaInfo?.durationMs ?? null,
  });

  // Lead voltou a falar → cancela qualquer follow-up pending (best-effort).
  cancelFollowUpsForLead(lead.id, "lead_replied").catch((e) =>
    console.error("[webhook] cancelFollowUps", e),
  );

  // Ponte ativa OU corretor já notificado (aguardando) OU ponte fechada por /fim.
  if (lead.assigned_agent_id && (lead.bridge_active || lead.human_takeover)) {
    const agentRow = await supabaseAdmin()
      .from("agents")
      .select("*")
      .eq("id", lead.assigned_agent_id)
      .maybeSingle();
    if (agentRow.data) {
      const mode: "bridge" | "waiting" | "closed" = lead.bridge_active
        ? "bridge"
        : (lead as any).bridge_closed_at
        ? "closed"
        : "waiting";
      await forwardToAgent({
        agent: agentRow.data as any,
        leadId: lead.id,
        leadName: lead.full_name || lead.push_name || lead.phone,
        leadPhone: lead.phone,
        text,
        mode,
      });
      return;
    }
  }

  if (lead.human_takeover) {
    return;
  }

  sendPresence(sendTarget, "composing").catch(() => {});

  scheduleInbound({
    lead,
    text,
    sendTarget,
    flush: runAgentTurn,
  }).catch((e) => console.error("[webhook] scheduleInbound", e));
}

async function runAgentTurn(args: { lead: Lead; combinedText: string; sendTarget: string }) {
  const { lead, combinedText, sendTarget } = args;
  sendPresence(sendTarget, "composing").catch(() => {});

  const prevScore = lead.score ?? 0;
  const prevStage = lead.stage ?? null;
  const prevStatus = lead.status ?? null;

  const {
    reply,
    needsHandoff,
    qualification,
    handoffReason,
    handoffUrgency,
    score,
    stage: nextStage,
    sources,
    mediaIntent,
    mediaCategoria,
  } = await runSDR({
    lead,
    userText: combinedText,
  });

  if (reply) {
    // Decisão áudio × texto (Vanguard 4.3). O wrapper aplica feature gate
    // `tts_enabled`, checa preferência do lead, roda classifier de conteúdo
    // e cai de volta pra texto em qualquer falha. `content` preservado
    // sempre com o texto — serve de transcript pra UI e pra lead memory.
    const outbound = await sendOutboundReply({
      leadId: lead.id,
      to: sendTarget,
      text: reply,
      source: "llm",
    });
    await appendMessage({
      leadId: lead.id,
      direction: "outbound",
      role: "assistant",
      content: reply,
      sources: sources.length > 0 ? sources : null,
      mediaType: outbound.modality === "audio" ? "audio" : null,
      mediaMime: outbound.modality === "audio" ? "audio/mpeg" : null,
      // `mediaPath` em formato `tts-cache/<hash>.mp3` (Slice 4.5) —
      // UI do /inbox detecta o prefixo e re-streama via /api/tts/play
      // em vez de gerar signed URL no bucket `messages-media`.
      mediaPath: outbound.mediaPath ?? null,
    });
  }

  // Envio de mídia fire-and-forget, depois do texto da Bia. A tool só
  // dispara se o router detectou pedido explícito E o retrieval trouxe
  // pelo menos um empreendimento. Falhas não afetam o turno — são logadas.
  if (mediaIntent && sources.length > 0) {
    const targetEmpId = sources[0].empreendimentoId;
    // sendTarget é phone ou JID @lid — ambos aceitos pelo endpoint Evolution,
    // mesmo formato que usamos em sendText acima.
    if (mediaIntent === "fotos") {
      sendEmpreendimentoFotos({
        empreendimento_id: targetEmpId,
        lead_phone: sendTarget,
        categoria: mediaCategoria ?? undefined,
      })
        .then((r) => {
          if (!r.ok) console.warn("[webhook] send_fotos:", r.reason);
        })
        .catch((e) => console.error("[webhook] send_fotos threw", e));
    } else if (mediaIntent === "booking") {
      sendEmpreendimentoBooking({
        empreendimento_id: targetEmpId,
        lead_phone: sendTarget,
      })
        .then((r) => {
          if (!r.ok) console.warn("[webhook] send_booking:", r.reason);
        })
        .catch((e) => console.error("[webhook] send_booking threw", e));
    }
  }

  // status muda pra "qualified" só se ainda não estava em won/lost — evita
  // regredir leads já fechados. stage vai literalmente pro que o router
  // decidiu (handoff_humano já vira "handoff" via router).
  const nextStatus = needsHandoff && prevStatus !== "won" && prevStatus !== "lost"
    ? "qualified"
    : undefined;
  const effectiveStage = needsHandoff ? "handoff" : (nextStage ?? undefined);

  await updateLead(lead.id, {
    qualification,
    stage: effectiveStage,
    status: nextStatus,
    human_takeover: needsHandoff ? true : undefined,
    score,
    score_updated_at: new Date().toISOString(),
  });

  // Timeline events (fire-and-forget). Só emitimos em mudanças reais pra
  // não poluir a timeline com ruído de cada turno.
  if (effectiveStage && effectiveStage !== prevStage) {
    emitLeadEvent({
      leadId: lead.id,
      kind: "stage_change",
      actor: "bia",
      payload: { from: prevStage, to: effectiveStage },
    });
  }
  if (nextStatus && nextStatus !== prevStatus) {
    emitLeadEvent({
      leadId: lead.id,
      kind: "status_change",
      actor: "bia",
      payload: { from: prevStatus, to: nextStatus },
    });
  }
  // Score jump: só marca pulos significativos (>= 10 pts) pra manter a
  // timeline limpa. Flutuação de 1-5 pts entre turnos é esperada.
  if (Math.abs(score - prevScore) >= 10) {
    emitLeadEvent({
      leadId: lead.id,
      kind: "score_jump",
      actor: "system",
      payload: { from: prevScore, to: score, delta: score - prevScore },
    });
  }
  if (needsHandoff) {
    emitLeadEvent({
      leadId: lead.id,
      kind: "handoff_requested",
      actor: "bia",
      payload: {
        reason: handoffReason ?? "lead_pediu_humano",
        urgency: handoffUrgency ?? "media",
      },
    });
  }

  // Memória persistente (Fatia I): refresh em background se passou do limite
  // de msgs desde o último update. Não bloqueia — Haiku pode levar 1-2s.
  // Antes do handoff é especialmente bom ter a memória atualizada porque o
  // brief pro corretor lê dela.
  refreshLeadMemoryAsync(lead.id);

  if (needsHandoff) {
    // Auto-brief (não bloqueia).
    if (!lead.brief) {
      try {
        const brief = await generateBrief(lead.id);
        await updateLead(lead.id, { brief, brief_at: new Date().toISOString() });
      } catch (e) {
        console.error("[webhook] auto-brief failed:", e instanceof Error ? e.message : e);
      }
    }
    // Dispara notificação pro corretor da vez (fire-and-forget).
    // Se o grafo (router/factcheck) definiu reason/urgency, usamos; senão
    // default pra "lead_pediu_humano" + "media" (handoff genérico).
    initiateHandoff(
      lead.id,
      handoffReason ?? "lead_pediu_humano",
      handoffUrgency ?? "media",
    ).catch((e) => console.error("[webhook] initiateHandoff failed:", e));
  }
}

/**
 * Mensagem de um corretor. Defaults invertidos:
 *  - Quote de notificação/mensagem minha → repasso texto pro lead (ponte abre).
 *  - `/lead <telefone> <mensagem>` → envio pro lead sem precisar de quote.
 *  - `/lead <telefone>` (sem texto) → abre sessão silenciosa.
 *  - `/fim`, `/status`, `/help` → comandos locais.
 *  - Texto solto (sem quote, sem comando) → Bia copiloto (não vai pro lead).
 */
async function handleAgentMessage(args: {
  phone: string;
  text: string;
  quotedText: string | null;
  sendTarget: string;
}) {
  const agent = await getAgentByPhone(args.phone);
  console.log("[agent-msg] start", {
    phone: args.phone,
    agentFound: Boolean(agent),
    agentId: agent?.id,
    currentLeadId: agent?.current_lead_id ?? null,
    hasQuote: Boolean(args.quotedText),
    text: args.text.slice(0, 120),
  });
  if (!agent) return;

  const t = args.text.trim();

  // ── Comandos locais ──
  if (/^\/(fim|sair)\b/i.test(t)) {
    let targetLeadId: string | null = agent.current_lead_id;
    if (!targetLeadId) {
      const sb = supabaseAdmin();
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("assigned_agent_id", agent.id)
        .eq("bridge_active", true)
        .limit(1)
        .maybeSingle();
      targetLeadId = (data?.id as string | undefined) ?? null;
    }
    if (targetLeadId) {
      await closeBridge(targetLeadId);
      await sendText({
        to: agent.phone,
        text: `✅ Ponte encerrada. Lead continua pausado no admin — retome a Bia por lá se quiser.`,
        delayMs: 0,
      });
    } else {
      await sendText({ to: agent.phone, text: "Sem ponte ativa.", delayMs: 0 });
    }
    return;
  }

  if (/^\/help\b/i.test(t)) {
    await sendText({ to: agent.phone, text: HELP_TEXT, delayMs: 0 });
    return;
  }

  if (/^\/status\b/i.test(t)) {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("leads")
      .select("id, phone, push_name, full_name, bridge_active, bridge_closed_at, handoff_notified_at")
      .eq("assigned_agent_id", agent.id)
      .order("handoff_notified_at", { ascending: false })
      .limit(10);
    const lines = (data ?? []).map((l: any) => {
      const name = l.full_name || l.push_name || l.phone;
      const state = l.bridge_active
        ? "🟢 ponte"
        : l.bridge_closed_at
        ? "💭 encerrada"
        : "🟡 aguardando";
      return `${state} ${name} · ${l.phone}`;
    });
    await sendText({
      to: agent.phone,
      text: lines.length > 0
        ? `${lines.join("\n")}\n\nEnviar mensagem: /lead <telefone> <mensagem>`
        : "Sem leads atribuídos.",
      delayMs: 0,
    });
    return;
  }

  // ── Referência explícita a lead? (quote OU /lead <ref>) ──
  const fromQuote = parseLeadRefFromQuote(args.quotedText);
  const cmdMatch = t.match(/^\/lead\s+(\S+)/i);
  const ref = fromQuote ?? cmdMatch?.[1] ?? null;

  if (ref) {
    const leadId = await leadIdFromRef(ref);
    console.log("[agent-msg] resolve ref", { ref, leadId, viaQuote: Boolean(fromQuote) });
    if (!leadId) {
      await sendText({
        to: agent.phone,
        text: `Lead "${ref}" não encontrado. Use /status pra ver atribuídos.`,
        delayMs: 0,
      });
      return;
    }
    const sb = supabaseAdmin();
    const { data: lead } = await sb
      .from("leads")
      .select("id, phone")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) {
      await sendText({ to: agent.phone, text: "Lead não encontrado.", delayMs: 0 });
      return;
    }

    await openBridge(lead.id, agent.id);

    // `/lead <ref>` sem texto (e sem quote) → só abre sessão.
    const cmdOnly = !fromQuote && /^\/lead\s+\S+\s*$/i.test(t);
    if (cmdOnly) {
      await sendText({
        to: agent.phone,
        text: `✅ Ponte aberta. Pra enviar ao lead, responda esta mensagem (quote) ou use /lead ${lead.phone} <texto>. Texto solto fica comigo (copiloto).`,
        delayMs: 0,
      });
      return;
    }

    // Fluxo de aprovação de draft: quote foi de uma mensagem DRAFT da Bia.
    const draftBody = args.quotedText ? parseDraftBody(args.quotedText) : null;
    if (draftBody) {
      const isApproval = APPROVAL_PATTERN.test(t);
      const finalText = isApproval ? draftBody : t;
      console.log("[agent-msg] draft approval", {
        isApproval,
        finalTextPreview: finalText.slice(0, 120),
      });
      await forwardToLead({
        leadId: lead.id,
        text: finalText,
        sendTarget: lead.phone,
      });
      // Métricas: marca o draft como approved/edited. Best-effort — se não
      // achar a linha (ex.: draft antigo, banco indisponível), não bloqueia
      // a entrega que já foi feita acima.
      try {
        const row = await findLatestProposed({ leadId: lead.id, agentId: agent.id });
        if (row) {
          await markDraftActed({
            id: row.id,
            action: isApproval ? "approved" : "edited",
            finalText,
          });
        } else {
          console.warn("[agent-msg] draft approval: nenhum 'proposed' encontrado pra atualizar", {
            leadId: lead.id,
            agentId: agent.id,
          });
        }
      } catch (e) {
        console.error("[agent-msg] draft metrics update failed:", e instanceof Error ? e.message : e);
      }
      await sendText({
        to: agent.phone,
        text: isApproval ? "✅ Draft aprovado e enviado." : "✅ Sua edição foi enviada.",
        delayMs: 300,
      });
      return;
    }

    // Remove prefixo do comando se veio via /lead <ref> texto.
    const cleanText = t.replace(/^\/lead\s+\S+\s*/i, "").trim();
    if (!cleanText) {
      await sendText({
        to: agent.phone,
        text: "Mande o texto que quer enviar pro lead.",
        delayMs: 0,
      });
      return;
    }

    await forwardToLead({
      leadId: lead.id,
      text: cleanText,
      sendTarget: lead.phone,
    });
    return;
  }

  // ── Texto solto → Bia copiloto ──
  console.log("[agent-msg] copilot → question", { agentId: agent.id, question: t });
  try {
    const { reply, draft } = await brokerCopilot({ agent, text: t });
    console.log("[agent-msg] copilot → reply", {
      agentId: agent.id,
      reply,
      hasDraft: Boolean(draft),
    });
    await sendText({
      to: agent.phone,
      text: reply || "Hmm, não consegui formular. Tenta de novo? /help pra comandos.",
      delayMs: 0,
    });
    if (draft) {
      // Resolve lead_id antes de enviar — precisamos pra gravar em drafts.
      // Se não achar o lead pelo telefone, ainda entregamos o draft pro
      // corretor (ele que sabe pra quem é), mas não gravamos métrica.
      const leadId = await leadIdFromRef(draft.leadPhone);
      if (leadId) {
        await recordDraft({
          leadId,
          agentId: agent.id,
          proposedText: draft.text,
          confidence: draft.confidence,
        });
      } else {
        console.warn("[agent-msg] draft record: lead não encontrado por telefone", {
          leadPhone: draft.leadPhone,
        });
      }

      // Mensagem separada, SÓ o texto do draft (segura+copia limpinho no WhatsApp).
      // Header e footer tão fora do texto principal pra não poluir no copy/paste.
      const confBadge =
        draft.confidence === "alta" ? "🟢" : draft.confidence === "media" ? "🟡" : "🔴";
      const draftMsg = `${DRAFT_MARKER} pro lead ${draft.leadPhone} · confiança ${confBadge} ${draft.confidence}
Responda 👍 pra eu enviar como está, ou responda com a versão editada.

${draft.text}

lead: ${draft.leadPhone}`;
      await sendText({ to: agent.phone, text: draftMsg, delayMs: 800 });
    }
  } catch (e) {
    console.error("[agent-msg] copilot failed:", e instanceof Error ? e.message : e);
    await sendText({
      to: agent.phone,
      text: "Deu ruim aqui no copiloto. Tenta de novo em instantes, ou use /help pra comandos.",
      delayMs: 0,
    });
  }
}

// Marker no início da mensagem de draft. Quando o corretor fizer quote dela,
// a gente detecta e roda o fluxo de aprovação.
const DRAFT_MARKER = "📝 [DRAFT]";

const APPROVAL_PATTERN = /^(\s*(👍|👌|ok|okay|ok!|aprovo|aprovado|aprova|manda|envia|envie|vai|go|beleza|blz|\+1)\s*\.?\s*)$/i;

/** Extrai o corpo (texto proposto) de uma mensagem de draft, dado o quote dela. */
function parseDraftBody(quotedText: string): string | null {
  if (!quotedText.startsWith(DRAFT_MARKER)) return null;
  // Corpo fica entre a linha "Responda 👍 ..." e o footer "lead: XXXX".
  const lines = quotedText.split("\n");
  const instructionIdx = lines.findIndex((l) => l.trim().startsWith("Responda 👍"));
  const footerIdx = lines.findIndex((l) => /^lead:\s*\d+/i.test(l.trim()));
  if (instructionIdx === -1 || footerIdx === -1 || footerIdx <= instructionIdx) return null;
  return lines
    .slice(instructionIdx + 1, footerIdx)
    .join("\n")
    .trim();
}

// ============================================================
// Multimodal pipeline
// ============================================================

type MediaProcessResult = {
  type: "audio" | "image" | "video";
  mime: string;
  path: string | null;
  durationMs: number | null;
  text: string | null;
  fallbackReply: string | null;
};

/**
 * Baixa mídia do Evolution, sobe pro storage, transcreve/descreve.
 * Em falha preenche `fallbackReply` pra auto-resposta ao lead.
 */
async function processIncomingMedia(args: {
  evolutionMessageId: string;
  detected: DetectedMedia;
}): Promise<MediaProcessResult> {
  const { detected, evolutionMessageId } = args;
  const result: MediaProcessResult = {
    type: detected.type,
    mime: detected.mime,
    path: null,
    durationMs: detected.durationMs ?? null,
    text: null,
    fallbackReply: null,
  };

  // Gate global por setting
  if (detected.type === "audio") {
    const enabled = (await getSetting("media_audio_enabled", "true")) === "true";
    if (!enabled) {
      result.fallbackReply =
        "Ainda não consigo ouvir áudios por aqui. Pode escrever o que você queria? 🙂";
      return result;
    }
  }
  if (detected.type === "image") {
    const enabled = (await getSetting("media_image_enabled", "true")) === "true";
    if (!enabled) {
      // Se tem caption, usa só ela; senão fallback
      if (detected.caption) {
        result.text = detected.caption;
        return result;
      }
      result.fallbackReply =
        "Imagens estão desligadas por aqui. Pode me contar em texto o que tinha na foto?";
      return result;
    }
  }

  let buffer: Buffer;
  try {
    buffer = await downloadFromEvolution(evolutionMessageId);
    await enforceMaxSize(buffer);
  } catch (e) {
    console.error("[webhook] media download/size:", e instanceof Error ? e.message : e);
    result.fallbackReply =
      detected.type === "audio"
        ? "Não consegui baixar seu áudio aqui. Pode reenviar ou escrever em texto?"
        : "Não consegui abrir essa imagem. Pode reenviar ou me contar em texto?";
    return result;
  }

  // Upload independente do sucesso da IA — assim sempre sobra replay no admin.
  // NOTE: usamos evolutionMessageId como identidade no path (estável, único).
  try {
    result.path = await uploadMedia({
      messageId: evolutionMessageId,
      type: detected.type,
      mime: detected.mime,
      buffer,
    });
  } catch (e) {
    console.error("[webhook] media upload:", e instanceof Error ? e.message : e);
    // não fatal — seguimos sem storage se só o upload falhou
  }

  if (detected.type === "audio") {
    try {
      const transcript = await transcribeAudio({
        buffer,
        mime: detected.mime,
        durationMs: detected.durationMs ?? null,
      });
      result.text = `🎤 ${transcript}`;
    } catch (e) {
      console.error("[webhook] transcribe:", e instanceof Error ? e.message : e);
      result.fallbackReply =
        "Não consegui entender seu áudio agora. Pode escrever em texto pra eu te ajudar?";
    }
    return result;
  }

  if (detected.type === "image") {
    try {
      const desc = await describeImage({
        buffer,
        mime: detected.mime,
        caption: detected.caption ?? null,
      });
      // Inclui caption original se houver + descrição
      result.text = detected.caption
        ? `🖼️ (imagem) ${detected.caption}\n\n[descrição automática: ${desc}]`
        : `🖼️ [imagem sem legenda — descrição automática: ${desc}]`;
    } catch (e) {
      console.error("[webhook] vision:", e instanceof Error ? e.message : e);
      // Se o lead mandou caption, ainda dá pra seguir sem vision
      if (detected.caption) {
        result.text = `🖼️ (imagem) ${detected.caption}`;
      } else {
        result.fallbackReply =
          "Recebi a imagem mas não consegui processar. Pode me contar brevemente o que tem nela?";
      }
    }
    return result;
  }

  // video: sem transcrição nessa fase. Só usa caption se tiver.
  if (detected.caption) {
    result.text = `🎥 (vídeo) ${detected.caption}`;
  } else {
    result.fallbackReply =
      "Recebi seu vídeo mas ainda não consigo assistir por aqui. Pode me contar em texto?";
  }
  return result;
}

/**
 * Envia resposta automática quando a mídia não pôde ser processada. Também
 * grava o evento bruto na tabela messages (com `media_type` mas `content`
 * genérico) pra a conversa ter contexto se o corretor olhar depois.
 */
async function dispatchMediaFallback(args: {
  it: any;
  innerMessage: any;
  pushName: string | undefined;
  mediaInfo: MediaProcessResult;
  evolutionMessageId: string | undefined;
}) {
  const { it, mediaInfo, evolutionMessageId } = args;
  const key = it?.key ?? it?.message?.key;
  const remoteJid: string | undefined = key?.remoteJid;
  if (!remoteJid) return;

  let realJid = remoteJid;
  if (remoteJid.endsWith("@lid")) {
    realJid = key?.remoteJidAlt || key?.senderPn || key?.participantPn || remoteJid;
  }
  const phone = jidToPhone(realJid);
  if (!phone || phone.length < 8) return;
  const sendTarget = realJid.endsWith("@lid") ? realJid : phone;

  // Não responde a corretor com fallback de mídia
  if (await isAgentPhone(phone)) return;

  const lead = await upsertLead(phone, args.pushName);
  const placeholder =
    mediaInfo.type === "audio"
      ? "🎤 [áudio que não pôde ser transcrito]"
      : mediaInfo.type === "image"
      ? "🖼️ [imagem que não pôde ser processada]"
      : "🎥 [vídeo recebido]";

  await appendMessage({
    leadId: lead.id,
    direction: "inbound",
    role: "user",
    content: placeholder,
    evolutionMessageId,
    evolutionEvent: it,
    mediaType: mediaInfo.type,
    mediaPath: mediaInfo.path,
    mediaMime: mediaInfo.mime,
    mediaDurationMs: mediaInfo.durationMs,
  });

  if (mediaInfo.fallbackReply) {
    await sendText({ to: sendTarget, text: mediaInfo.fallbackReply, delayMs: 900 });
    await appendMessage({
      leadId: lead.id,
      direction: "outbound",
      role: "assistant",
      content: mediaInfo.fallbackReply,
    });
  }
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "POST events here from Evolution API." });
}
