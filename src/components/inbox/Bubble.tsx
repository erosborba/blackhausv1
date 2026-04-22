"use client";

import type { ThreadMessage, MessageSource } from "./types";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
  if (variant === "ai") return "IA · blackhaus";
  return "Você";
}

export function Bubble({ m }: { m: ThreadMessage }) {
  const variant = bubbleVariant(m);
  const pending = m.id.startsWith("optim-");

  return (
    <>
      <div
        className={`bubble ${variant}${pending ? " pending" : ""}`}
        style={pending ? { opacity: 0.65 } : undefined}
      >
        <div className="who">{whoLabel(variant)}</div>
        {m.media_type ? <MediaTag kind={m.media_type} /> : null}
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
