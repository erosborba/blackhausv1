"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Lead } from "@/lib/leads";
import type { ThreadMessage, SuggestedAction } from "./types";
import { Bubble } from "./Bubble";
import { HUD, type HUDHandle } from "./HUD";
import { Composer, type ComposerHandle } from "./Composer";
import { Avatar } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chip";
import { supabaseBrowser } from "@/lib/supabase";

/**
 * Coluna central — thread + header + HUD + Composer.
 *
 * Arquitetura:
 *   - ThreadView coordena HUD ↔ Composer via refs (HUDHandle, ComposerHandle).
 *   - Click em ação do HUD popula Composer; shift+click envia direto.
 *   - Polling 3s p/ msgs + takeover state.
 *   - Toggle "Devolver para IA após envio" vive aqui (controlado).
 */
export function ThreadView({
  lead,
  initialMessages,
}: {
  lead: Lead;
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [takeover, setTakeover] = useState(lead.human_takeover);
  const [returnToIa, setReturnToIa] = useState(false);
  const [actionBusy, setActionBusy] = useState<"takeover" | "resume" | null>(null);
  const [suggestingFromComposer, setSuggestingFromComposer] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HUDHandle>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const name = lead.full_name ?? lead.push_name ?? lead.phone;

  // Dados de qualificação
  const quartos = lead.qualification?.quartos ? `${lead.qualification.quartos} dorms` : null;
  const orcamento = fmtPrice(lead.qualification?.faixa_preco_max);
  const subParts = [quartos, orcamento, "WhatsApp"].filter(Boolean).join(" · ");

  // Confiança baseada no score
  const confDots = Math.round(((lead.score ?? 0) / 100) * 5);
  const confPct = lead.score ?? 0;
  const confTone = confPct >= 70 ? "ok" : confPct >= 40 ? "" : "hot";

  // Refetch helper — usado como fallback quando realtime perde evento
  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${lead.id}?limit=80`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setMessages(json.data.messages);
        setTakeover(json.data.lead?.human_takeover ?? false);
      }
    } catch {
      /* silencia */
    }
  }, [lead.id]);

  // Realtime: subscribe a INSERT em messages + UPDATE em leads.
  // Polling 30s como safety-net (canal pode desconectar silenciosamente).
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`lead:${lead.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload) => {
          const m = payload.new as ThreadMessage;
          setMessages((prev) => {
            // Dedup por id
            if (prev.some((x) => x.id === m.id)) return prev;
            // Se veio outbound e temos optimistic placeholder com mesmo conteúdo,
            // substituir pra preservar scroll/posição.
            if (m.direction === "outbound") {
              const optIdx = prev.findIndex(
                (x) =>
                  x.id.startsWith("optim-") &&
                  x.direction === "outbound" &&
                  x.content === m.content,
              );
              if (optIdx >= 0) {
                const next = prev.slice();
                next[optIdx] = m;
                return next;
              }
            }
            return [...prev, m];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload) => {
          const m = payload.new as ThreadMessage;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `id=eq.${lead.id}`,
        },
        (payload) => {
          const updated = payload.new as { human_takeover?: boolean };
          if (typeof updated.human_takeover === "boolean") {
            setTakeover(updated.human_takeover);
          }
        },
      )
      .subscribe();

    const iv = setInterval(refetch, 30_000);
    return () => {
      clearInterval(iv);
      sb.removeChannel(channel);
    };
  }, [lead.id, refetch]);

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function handleTakeover() {
    setActionBusy("takeover");
    try {
      const res = await fetch(`/api/leads/${lead.id}/takeover`, {
        method: "POST",
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setTakeover(true);
        composerRef.current?.focus();
      }
    } catch {
      /* silencia */
    } finally {
      setActionBusy(null);
    }
  }

  async function handleResume() {
    setActionBusy("resume");
    try {
      await fetch(`/api/leads/${lead.id}/takeover`, {
        method: "DELETE",
        cache: "no-store",
      });
      setTakeover(false);
    } catch {
      /* silencia */
    } finally {
      setActionBusy(null);
    }
  }

  // HUD → Composer: popula textarea pra o corretor revisar
  function handlePickAction(a: SuggestedAction) {
    composerRef.current?.setDraft(a.body);
  }

  // HUD → envio direto (shift+enter ou shift+click)
  async function handleSendAction(a: SuggestedAction) {
    await composerRef.current?.sendNow(a.body);
  }

  // Composer → HUD: clicou em "Sugerir" no toolbar da composer
  async function handleRequestSuggestion(): Promise<string | null> {
    if (!hudRef.current) return null;
    setSuggestingFromComposer(true);
    try {
      const list = await hudRef.current.suggest();
      return list[0]?.body ?? null;
    } finally {
      setSuggestingFromComposer(false);
    }
  }

  // Mensagens visíveis (filtra system/tool)
  const visibleMessages = messages.filter((m) => m.role !== "system" && m.role !== "tool");

  return (
    <div className="pane" style={{ background: "var(--bg)" }}>
      {/* Cabeçalho */}
      <header className="conv-header">
        <Avatar name={name} size="lg" />
        <div className="conv-title">
          <div className="who">
            {name}
            {takeover ? (
              <Chip tone="ok" dot>
                Corretor ativo
              </Chip>
            ) : (
              <Chip tone="warm" dot>
                IA atendendo
              </Chip>
            )}
          </div>
          {subParts ? <div className="sub">{subParts}</div> : null}
        </div>
        <div className="conv-actions">
          <div className={`confidence${confTone ? ` ${confTone}` : ""}`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={i < confDots ? "on" : ""} />
            ))}
          </div>
          <span
            className="conf-label"
            style={{ color: confPct < 50 ? "var(--warm)" : "var(--ok)" }}
          >
            conf {confPct}%
          </span>

          {takeover ? (
            <button
              className="btn sm"
              type="button"
              onClick={handleResume}
              disabled={actionBusy === "resume"}
              title="Devolve o controle pra Bia"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
              {actionBusy === "resume" ? "Devolvendo…" : "Devolver IA"}
            </button>
          ) : (
            <button
              className="btn sm primary"
              type="button"
              onClick={handleTakeover}
              disabled={actionBusy === "takeover"}
              title="Pausa a Bia e gera um brief do lead"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
              {actionBusy === "takeover" ? "Assumindo…" : "Assumir"}
            </button>
          )}
        </div>
      </header>

      {/* Thread body */}
      <div ref={bodyRef} className="conv-body">
        {visibleMessages.length === 0 ? (
          <div style={{ color: "var(--ink-4)", textAlign: "center", marginTop: 40, fontSize: 13 }}>
            Ainda sem mensagens.
          </div>
        ) : (
          visibleMessages.map((m, idx) => {
            const prev = visibleMessages[idx - 1];
            const showDateSep =
              idx === 0 ||
              (prev &&
                new Date(m.created_at).toDateString() !==
                  new Date(prev.created_at).toDateString());
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {showDateSep ? <div className="event">{fmtDateEvent(m.created_at)}</div> : null}
                <Bubble m={m} />
              </div>
            );
          })
        )}
      </div>

      {/* HUD — ações sugeridas */}
      <HUD
        ref={hudRef}
        leadId={lead.id}
        onPickAction={handlePickAction}
        onSendAction={handleSendAction}
      />

      {/* Composer */}
      <Composer
        ref={composerRef}
        leadId={lead.id}
        returnToIa={returnToIa}
        onToggleReturnToIa={() => setReturnToIa((v) => !v)}
        onRequestSuggestion={handleRequestSuggestion}
        suggesting={suggestingFromComposer}
        onSent={(sentText) => {
          // Echo otimista — mensagem aparece imediatamente; será substituída
          // pela versão real quando o realtime INSERT chegar (dedup por content).
          const optimistic: ThreadMessage = {
            id: `optim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: "user",
            direction: "outbound",
            content: sentText,
            created_at: new Date().toISOString(),
            media_type: null,
            media_path: null,
            media_mime: null,
            media_duration_ms: null,
            sources: null,
          };
          setMessages((prev) => [...prev, optimistic]);
        }}
      />
    </div>
  );
}

function fmtDateEvent(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtPrice(val: unknown): string | null {
  if (typeof val !== "number") return null;
  if (val >= 1_000_000) return `até R$ ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `até R$ ${(val / 1_000).toFixed(0)}k`;
  return `até R$ ${val}`;
}
