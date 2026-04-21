"use client";

import type { ThreadMessage, MessageSource } from "./types";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function Bubble({ m }: { m: ThreadMessage }) {
  const dir = m.direction;
  return (
    <div className={`bubble-row ${dir}`} style={{ flexDirection: "column", alignItems: dir === "outbound" ? "flex-end" : "flex-start" }}>
      <div className={`bubble ${dir}`}>
        {m.media_type ? <MediaBadge kind={m.media_type} /> : null}
        {m.content}
      </div>
      <div className="bubble-meta">{fmtTime(m.created_at)}</div>
      {dir === "outbound" && m.sources && m.sources.length > 0 ? (
        <SourceBar sources={m.sources} />
      ) : null}
    </div>
  );
}

function MediaBadge({ kind }: { kind: "audio" | "image" | "video" }) {
  const label = kind === "audio" ? "🎙 áudio" : kind === "image" ? "🖼 imagem" : "🎞 vídeo";
  return (
    <div
      style={{
        fontSize: 10.5,
        color: "var(--ink-3)",
        marginBottom: 4,
        fontFamily: "var(--font-mono)",
      }}
    >
      {label}
    </div>
  );
}

export function SourceBar({ sources }: { sources: MessageSource[] }) {
  // Dedupe por empreendimentoId (já vem assim do retrieval, mas defensivo)
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
  if (href) {
    return (
      <a href={href} className="source-pill">
        {inner}
      </a>
    );
  }
  return <span className="source-pill">{inner}</span>;
}
