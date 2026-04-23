"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Lead } from "@/lib/leads";
import type { ThreadMessage, SuggestedAction } from "./types";
import { Bubble } from "./Bubble";
import { HUD, type HUDHandle } from "./HUD";
import { Composer, type ComposerHandle } from "./Composer";
import { Avatar } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chip";
import { Timeline } from "./Timeline";
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
  const [activeTab, setActiveTab] = useState<"chat" | "timeline" | "details" | "files" | "history">(
    "chat",
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HUDHandle>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // Scroll autônomo — se usuário rola pra cima, pausa auto-scroll por 4s
  const scrollPausedUntilRef = useRef<number>(0);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Auto-scroll — sempre desce no mount/troca de lead; ao chegar msg nova,
  // só desce se usuário não rolou pra cima nos últimos 4s.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (Date.now() < scrollPausedUntilRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, activeTab]);

  // Detecta scroll manual — pausa auto-scroll e agenda retorno ao fim após 4s
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < 40) {
        // Já está no fim — limpa pausa e timer
        scrollPausedUntilRef.current = 0;
        if (returnTimerRef.current) {
          clearTimeout(returnTimerRef.current);
          returnTimerRef.current = null;
        }
        return;
      }
      // Usuário rolou pra cima — pausa 4s e agenda retorno
      scrollPausedUntilRef.current = Date.now() + 4000;
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      returnTimerRef.current = setTimeout(() => {
        const node = bodyRef.current;
        if (!node) return;
        scrollPausedUntilRef.current = 0;
        node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
      }, 4000);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    };
  }, [activeTab]);

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

  const phone = lead.phone;
  const emailRaw = (lead.qualification as Record<string, unknown> | null)?.email;
  const email = typeof emailRaw === "string" ? emailRaw : null;
  const locationRaw = (lead.qualification as Record<string, unknown> | null)?.bairro;
  const location = typeof locationRaw === "string" ? locationRaw : null;

  const tabs: Array<{ key: typeof activeTab; label: string }> = [
    { key: "chat", label: "Conversa" },
    { key: "timeline", label: "Timeline" },
    { key: "details", label: "Detalhes" },
    { key: "files", label: "Arquivos" },
    { key: "history", label: "Histórico" },
  ];

  return (
    <div className="pane pane-thread">
      {/* Hero — avatar grande, nome display, dados de contato, status */}
      <header className="conv-hero">
        <div className="conv-hero-main">
          <Avatar name={name} size="lg" variant="blue" />
          <div className="conv-hero-info">
            <h1 className="conv-hero-name">{name}</h1>
            <div className="conv-hero-contact">
              {phone ? <span>{phone}</span> : null}
              {email ? <span>{email}</span> : null}
              {location ? <span>{location}</span> : null}
            </div>
            {subParts ? <div className="conv-hero-sub">{subParts}</div> : null}
          </div>
          <div className="conv-hero-side">
            <div className="conv-hero-chips">
              {takeover ? (
                <Chip tone="ok" dot>
                  Corretor ativo
                </Chip>
              ) : (
                <Chip tone="warm" dot>
                  IA atendendo
                </Chip>
              )}
              <Chip tone={confPct >= 70 ? "ok" : confPct >= 40 ? "warm" : "hot"}>
                {confPct >= 70 ? "Quente" : confPct >= 40 ? "Morno" : "Frio"}
              </Chip>
            </div>
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
          </div>
        </div>

        {/* Tabs */}
        <div className="hero-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`hero-tab${activeTab === t.key ? " is-active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          <div className="hero-tabs-actions">
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
        </div>
      </header>

      {/* Tab content */}
      {activeTab === "chat" ? (
        <>
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

          <HUD
            ref={hudRef}
            leadId={lead.id}
            onPickAction={handlePickAction}
            onSendAction={handleSendAction}
          />

          <Composer
            ref={composerRef}
            leadId={lead.id}
            returnToIa={returnToIa}
            onToggleReturnToIa={() => setReturnToIa((v) => !v)}
            onRequestSuggestion={handleRequestSuggestion}
            suggesting={suggestingFromComposer}
            onSent={(sentText) => {
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
        </>
      ) : activeTab === "timeline" ? (
        <div className="tab-content">
          <TimelineTab leadId={lead.id} />
        </div>
      ) : activeTab === "details" ? (
        <div className="tab-content">
          <DetailsTab lead={lead} />
        </div>
      ) : (
        <div className="tab-content tab-empty">
          <div className="tab-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {activeTab === "files" ? (
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </>
              )}
            </svg>
          </div>
          <p className="tab-empty-title">Em breve</p>
          <p className="tab-empty-sub">
            {activeTab === "files"
              ? "Arquivos trocados no WhatsApp aparecerão aqui."
              : "Histórico completo de interações em breve."}
          </p>
        </div>
      )}
    </div>
  );
}

/** Tab timeline — reaproveita o componente Timeline existente. */
function TimelineTab({ leadId }: { leadId: string }) {
  return (
    <div style={{ padding: "20px 24px" }}>
      <h3 style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 12, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Eventos do lead
      </h3>
      <Timeline leadId={leadId} />
    </div>
  );
}

/** Tab detalhes — render do qualification estruturado. */
function DetailsTab({ lead }: { lead: Lead }) {
  const q = (lead.qualification ?? {}) as Record<string, unknown>;
  const entries = Object.entries(q).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div style={{ padding: "20px 24px", overflowY: "auto" }}>
      <h3 style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 12, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Qualificação
      </h3>
      {entries.length === 0 ? (
        <p style={{ color: "var(--ink-4)", fontSize: 13 }}>Sem dados de qualificação ainda.</p>
      ) : (
        <div className="details-grid">
          {entries.map(([k, v]) => (
            <div key={k} className="details-row">
              <span className="details-k">{k.replace(/_/g, " ")}</span>
              <span className="details-v">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
            </div>
          ))}
        </div>
      )}
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
