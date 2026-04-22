"use client";

import type { ThreadMessage, MessageSource } from "./types";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Extrai hash sha256 de um `media_path` no formato `tts-cache/<hash>.mp3`.
 * Retorna null se o formato não bate — aí o bubble cai no MediaTag
 * estático (áudios inbound vivem em outro bucket).
 *
 * Detalhe: regex literal, não parse manual — garante hex de 64 chars e
 * rejeita tentativas de path traversal caso algo escreva path maluco.
 */
const TTS_PATH_RE = /^tts-cache\/([a-f0-9]{64})\.mp3$/;
function extractTtsKey(path: string | null): string | null {
  if (!path) return null;
  const m = TTS_PATH_RE.exec(path);
  return m ? m[1] : null;
}

/**
 * Bubble — 3 variantes conforme hifi:
 * - them : user inbound (lead escreveu)
 * - ai   : assistant outbound (IA respondeu)  ← azul tint, alinhado à direita
 * - me   : corretor outbound (humano enviou)  ← dark, alinhado à direita
 *
 * Derivação: role="user" + direction="inbound"  → them
 *            role="assistant"                   → ai
 *            role="user" + direction="outbound" → me (corretor via bridge)
 */
function bubbleVariant(m: ThreadMessage): "them" | "ai" | "me" {
  if (m.direction === "inbound") return "them";
  if (m.role === "assistant") return "ai";
  return "me"; // corretor assumiu e enviou
}

function whoLabel(variant: "them" | "ai" | "me"): string {
  if (variant === "them") return "Lead";
  if (variant === "ai") return "IA · lumihaus";
  return "Você";
}

export function Bubble({ m }: { m: ThreadMessage }) {
  const variant = bubbleVariant(m);
  const pending = m.id.startsWith("optim-");

  // Áudios outbound da Bia (Slice 4.5) têm media_path
  // `tts-cache/<hash>.mp3` — servíveis via `/api/tts/play` (endpoint
  // determinístico, blob imutável).
  // Áudios inbound do lead moram em `messages-media` bucket com path
  // `audio/<id>.ogg` — servíveis via `/api/media/play`.
  const ttsKey =
    m.media_type === "audio" && m.direction === "outbound"
      ? extractTtsKey(m.media_path)
      : null;
  const inboundAudioPath =
    m.media_type === "audio" && m.direction === "inbound" && m.media_path
      ? m.media_path
      : null;

  return (
    <>
      <div
        className={`bubble ${variant}${pending ? " pending" : ""}`}
        style={pending ? { opacity: 0.65 } : undefined}
      >
        <div className="who">{whoLabel(variant)}</div>
        {ttsKey ? (
          <TtsPlayer ttsKey={ttsKey} />
        ) : inboundAudioPath ? (
          <InboundAudioPlayer path={inboundAudioPath} durationMs={m.media_duration_ms} />
        ) : m.media_type ? (
          <MediaTag kind={m.media_type} />
        ) : null}
        {m.content}
        <span className="time">
          {pending ? "enviando…" : fmtTime(m.created_at)}
        </span>
      </div>
      {variant !== "them" && m.sources && m.sources.length > 0 ? (
        <SourceBar sources={m.sources} />
      ) : null}
    </>
  );
}

function MediaTag({ kind }: { kind: "audio" | "image" | "video" }) {
  const label =
    kind === "audio" ? "🎙 áudio" : kind === "image" ? "🖼 imagem" : "🎞 vídeo";
  return <div className="media-tag">{label}</div>;
}

/**
 * Player inline pro áudio que a Bia mandou. `preload="none"` pra não
 * baixar blob até o corretor clicar no play — em threads com várias
 * respostas por áudio isso economiza banda em quem só está lendo.
 *
 * O `<audio controls>` nativo é feio porém zero-custo: sem estado, sem
 * ref, sem useEffect, funciona em todo browser. Se virar dor de UX,
 * trocar por custom player é trivial (o endpoint já streama corretamente
 * com `Accept-Ranges: bytes`).
 *
 * O transcript continua visível no próprio `m.content` logo abaixo —
 * corretor consegue ler sem ouvir, bater com o que saiu, auditar.
 */
function TtsPlayer({ ttsKey }: { ttsKey: string }) {
  return (
    <div className="media-tag" style={{ marginBottom: 6 }}>
      <div style={{ marginBottom: 4 }}>🎙 áudio enviado</div>
      <audio
        controls
        preload="none"
        src={`/api/tts/play?key=${ttsKey}`}
        style={{
          width: "100%",
          maxWidth: 280,
          height: 32,
          display: "block",
        }}
      />
    </div>
  );
}

/**
 * Player pro áudio que o lead mandou. Streama direto do bucket
 * `messages-media` via `/api/media/play` — sem signed URL round-trip.
 *
 * O `content` do bubble abaixo já vem com a transcrição do Whisper, então
 * o corretor pode ler sem escutar. Mostramos a duração quando o webhook
 * populou (Evolution nem sempre manda), ajuda o corretor a decidir se
 * vale a pena botar no fone.
 */
function InboundAudioPlayer({
  path,
  durationMs,
}: {
  path: string;
  durationMs: number | null;
}) {
  const sec = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;
  return (
    <div className="media-tag" style={{ marginBottom: 6 }}>
      <div style={{ marginBottom: 4 }}>
        🎙 áudio do lead{sec ? ` · ${sec}s` : ""}
      </div>
      <audio
        controls
        preload="none"
        src={`/api/media/play?path=${encodeURIComponent(path)}`}
        style={{
          width: "100%",
          maxWidth: 280,
          height: 32,
          display: "block",
        }}
      />
    </div>
  );
}

export function SourceBar({ sources }: { sources: MessageSource[] }) {
  const seen = new Set<string>();
  const unique = sources.filter((s) => {
    if (seen.has(s.empreendimentoId)) return false;
    seen.add(s.empreendimentoId);
    return true;
  });
  return (
    <div className="source-bar">
      {unique.slice(0, 4).map((s) => (
        <SourcePill key={s.empreendimentoId} source={s} />
      ))}
    </div>
  );
}

function SourcePill({ source }: { source: MessageSource }) {
  const href = source.slug ? `/empreendimentos/${source.slug}` : undefined;
  const inner = (
    <>
      <span>📎</span>
      <span>{source.nome}</span>
      {source.score !== null ? (
        <span className="score">{(source.score * 100).toFixed(0)}</span>
      ) : null}
    </>
  );
  return href ? (
    <a href={href} className="source-pill">{inner}</a>
  ) : (
    <span className="source-pill">{inner}</span>
  );
}
