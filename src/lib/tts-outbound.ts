/**
 * Vanguard · Track 4 · Slice 4.3 — envio outbound com decisão áudio/texto.
 *
 * Encapsula o fluxo de:
 *   1. Checar `tts_enabled` global (feature gate)
 *   2. Computar `leadPrefersAudio`
 *   3. Classificar conteúdo via `shouldUseAudio`
 *   4. Verificar budget diário (slice 4.4) — spent + estimativa do pending
 *   5. Se áudio: presence "recording" → synthesize → sendAudio
 *   6. Se texto OU se qualquer passo acima falhar: sendText
 *
 * Mantido fora do webhook pra que o webhook continue legível e pra que
 * outros lugares (ex.: proactive outreach em Track 5) possam reusar.
 *
 * Retorna qual modalidade *efetivamente* saiu + razão, pra o caller
 * logar em `messages.media_type` e debug.
 */
import { getSettingBool } from "./settings";
import { sendAudio, sendPresence, sendText } from "./evolution";
import { synthesize } from "./tts";
import { computeTtsCostUsd } from "./tts-pure";
import { shouldUseAudio, type ModalitySource } from "./tts-classify";
import { leadPrefersAudio } from "./tts-preference";
import { checkTtsBudget } from "./tts-budget";

export type OutboundReplyInput = {
  leadId: string;
  to: string;        // phone ou JID — mesmo formato aceito por sendText/sendAudio
  text: string;
  /**
   * "llm" = resposta livre do answerNode → passa pelo classifier.
   * "tool" = output de tool (finance, mcmv, fotos) → sempre texto.
   */
  source?: ModalitySource;
  /**
   * Se informado e o áudio for usado, quote no PTT a mensagem do lead.
   */
  quotedId?: string;
};

export type OutboundReplyResult = {
  /** Modalidade que efetivamente saiu. */
  modality: "audio" | "text";
  /** Slug da decisão (ou motivo do fallback). */
  reason: string;
  /** true quando houve intenção de áudio mas caiu pra texto (falha TTS/envio). */
  fellBack: boolean;
  /**
   * Caminho canônico pro blob cacheado, quando `modality === "audio"`.
   * Formato: `tts-cache/<sha256>.mp3` — prefixado com o nome do bucket
   * pra que o `Bubble.tsx` saiba distinguir de áudios inbound (que vivem
   * no bucket `messages-media`). Usado pela UI do /inbox em Slice 4.5
   * pra re-servir o mp3 via `/api/tts/play?key=<hash>`.
   */
  mediaPath?: string | null;
};

/**
 * Envia `text` pro `to`, decidindo se vai como PTT ou texto comum.
 * Sempre resolve — nunca throws; falhas viram fallback pra sendText.
 *
 * (O throw do sendText propaga; considera-se erro crítico se nem texto
 * consegue sair. Aí o caller decide o que fazer — hoje ninguém captura.)
 */
export async function sendOutboundReply(
  input: OutboundReplyInput,
): Promise<OutboundReplyResult> {
  const source = input.source ?? "llm";

  // Log único por turno — deixa diagnosticar por que a decisão saiu
  // assim no webhook sem ter que rodar grep + adivinhar.
  const debug = (reason: string, extra?: Record<string, unknown>) => {
    console.log("[tts-outbound] decision", {
      leadId: input.leadId,
      reason,
      source,
      textLen: input.text.length,
      textPreview: input.text.slice(0, 80),
      ...extra,
    });
  };

  // 1) Feature gate global. Default `false` até operador virar.
  const ttsEnabled = await getSettingBool("tts_enabled", false);
  if (!ttsEnabled) {
    debug("tts_disabled");
    await sendText({ to: input.to, text: input.text, delayMs: 900 });
    return { modality: "text", reason: "tts_disabled", fellBack: false };
  }

  // 2) Preferência do lead (last 3 inbound com algum áudio).
  const prefersAudio = await leadPrefersAudio(input.leadId);

  // 3) Classifier.
  const decision = shouldUseAudio({
    text: input.text,
    leadPrefersAudio: prefersAudio,
    source,
  });

  if (!decision.audio) {
    debug(decision.reason, { prefersAudio });
    await sendText({ to: input.to, text: input.text, delayMs: 900 });
    return { modality: "text", reason: decision.reason, fellBack: false };
  }

  // 4) Budget check (Slice 4.4). Roda DEPOIS do classifier pra que
  //    respostas que iriam pra texto de qualquer jeito não gastem query.
  //    `pendingUsd` estima o custo da próxima síntese por char count —
  //    aceita que cache hits fazem pending "sobrar" (fail-safe: erra
  //    pra lado conservador, nunca pra overshoot).
  const pendingUsd = computeTtsCostUsd(input.text.length);
  const budget = await checkTtsBudget(pendingUsd);
  if (!budget.allowed) {
    debug("budget_exceeded", {
      spentUsd: budget.spentUsd,
      pendingUsd,
      capUsd: budget.capUsd,
      prefersAudio,
    });
    await sendText({ to: input.to, text: input.text, delayMs: 900 });
    return { modality: "text", reason: "budget_exceeded", fellBack: true };
  }

  // 5) Tenta áudio — presence "recording" só pra mimetizar humano (ghost
  //    UX no WhatsApp). Fire-and-forget: se falhar não bloqueia envio.
  sendPresence(input.to, "recording").catch(() => {});

  try {
    const { buffer, cacheHit, cacheKey } = await synthesize({
      text: input.text,
      leadId: input.leadId,
    });
    await sendAudio({
      to: input.to,
      audioBase64: buffer.toString("base64"),
      delayMs: 900,
      quotedId: input.quotedId,
    });
    debug(cacheHit ? "audio_cache_hit" : "audio_synth", {
      prefersAudio,
      cacheKey: cacheKey.slice(0, 12),
    });
    return {
      modality: "audio",
      reason: cacheHit ? "audio_cache_hit" : "audio_synth",
      fellBack: false,
      // Cache é determinístico (hash voice+model+text): enquanto o blob
      // estiver no bucket, qualquer um consegue re-stream. Gravar o path
      // dispensa re-sintetizar na UI.
      mediaPath: `tts-cache/${cacheKey}.mp3`,
    };
  } catch (e) {
    // 6) Fallback: TTS ou sendAudio quebrou. Cai elegante pra texto.
    debug("audio_failed", {
      prefersAudio,
      error: e instanceof Error ? e.message : String(e),
    });
    await sendText({ to: input.to, text: input.text, delayMs: 900 });
    return {
      modality: "text",
      reason: "audio_failed",
      fellBack: true,
    };
  }
}
