"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads";
import { Timeline } from "./Timeline";
import { Chip } from "@/components/ui/Chip";
import { HANDOFF_REASON_LABEL, HANDOFF_URGENCY_EMOJI } from "@/lib/handoff-copy";
import { PIPELINE_STAGES, PIPELINE_STAGE_LABEL, type PipelineStage } from "@/lib/pipeline";
import type { TopEmpreendimento } from "@/lib/lead-context";

/**
 * Coluna direita — contexto do lead (Radar · Corretor · Empreendimento
 * favorito · Interesses · Objeções · Handoff · Brief · Ações · Timeline).
 *
 * Atalhos globais (desativados quando foco em textarea/input):
 *   ⌘V → abrir /agenda pra marcar visita
 *   ⌘P → abrir perfil do lead
 *   ⌘S → abrir seletor de estágio
 */
export function ContextRail({
  lead,
  agentName,
  topEmpreendimento,
}: {
  lead: Lead;
  agentName?: string | null;
  topEmpreendimento?: TopEmpreendimento | null;
}) {
  const router = useRouter();
  const q = (lead.qualification ?? {}) as Record<string, unknown>;
  const score = lead.score ?? 0;

  const priceMin = fmtShortPrice(q.faixa_preco_min);
  const priceMax = fmtShortPrice(q.faixa_preco_max);
  const priceRange =
    priceMin && priceMax ? `${priceMin}–${priceMax}` : priceMax ?? priceMin ?? null;

  const tone = score >= 70 ? "ok" : score >= 40 ? "warm" : "hot";
  const toneLabel = score >= 70 ? "forte" : score >= 40 ? "morno" : "frio";

  // Interesses extraídos do qualification
  const interests: string[] = [];
  if (q.quartos) interests.push(`${q.quartos} dorms`);
  if (q.tipo) interests.push(String(q.tipo));
  if (q.bairros && Array.isArray(q.bairros)) interests.push(...(q.bairros as string[]).slice(0, 3));
  else if (q.bairro) interests.push(String(q.bairro));
  if (priceMax) interests.push(`até ${priceMax}`);
  if (q.finalidade) interests.push(String(q.finalidade));

  // Objeções detectadas — extraídas do handoff
  const objections: Array<{ label: string; status: "open" | "resolved" }> = [];
  if (lead.handoff_reason) {
    objections.push({
      label: HANDOFF_REASON_LABEL[lead.handoff_reason] ?? lead.handoff_reason,
      status: lead.bridge_active ? "resolved" : "open",
    });
  }

  const currentStage = (lead.stage ?? null) as PipelineStage | null;
  const stageLabel = currentStage ? PIPELINE_STAGE_LABEL[currentStage] ?? currentStage : "—";
  const prazo = typeof q.prazo === "string" ? q.prazo : null;
  const origem = typeof q.origem === "string" ? q.origem : null;

  // Mudar estágio — dropdown controlado
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageErr, setStageErr] = useState<string | null>(null);
  const stagePickerRef = useRef<HTMLDivElement>(null);

  async function handlePickStage(next: PipelineStage) {
    if (next === currentStage) {
      setStagePickerOpen(false);
      return;
    }
    setStageBusy(true);
    setStageErr(null);
    try {
      const res = await fetch("/api/pipeline/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, to_stage: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha ao mover");
      setStagePickerOpen(false);
      router.refresh();
    } catch (e) {
      setStageErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setStageBusy(false);
    }
  }

  // Atalhos globais — ⌘V / ⌘P / ⌘S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const editing =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
      if (editing) return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === "v") {
        e.preventDefault();
        router.push(`/agenda?lead=${lead.id}`);
      } else if (k === "p") {
        e.preventDefault();
        router.push(`/leads/${lead.id}`);
      } else if (k === "s") {
        e.preventDefault();
        setStagePickerOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead.id, router]);

  // Fecha dropdown ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!stagePickerOpen) return;
    function onDown(e: MouseEvent) {
      if (!stagePickerRef.current?.contains(e.target as Node)) setStagePickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setStagePickerOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [stagePickerOpen]);

  return (
    <div className="pane">
      <div className="pane-head">
        <h3>Contexto</h3>
        <span className="count">{lead.full_name ?? lead.push_name ?? lead.phone}</span>
        <Link
          href={`/leads/${lead.id}`}
          className="btn sm ghost icon"
          style={{ marginLeft: "auto" }}
          title="Abrir perfil completo (⌘P)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </Link>
      </div>

      <div className="ctx">
        {/* ─── Radar ─── */}
        <section>
          <h4>Radar</h4>
          <div className="score-ring">
            <div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: `var(--${tone})`,
                }}
              >
                {score}
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "var(--ink-4)",
                  letterSpacing: "0.06em",
                  marginTop: 1,
                }}
              >
                /100
              </div>
            </div>
            <div className="radar-meter">
              <div className="meter" style={{ flex: "none" }}>
                <span className={tone} style={{ width: `${score}%` }} />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                score · {toneLabel}
              </span>
            </div>
          </div>

          {/* Estágio — clique abre picker */}
          <div
            className="kv"
            ref={stagePickerRef}
            style={{ position: "relative" }}
          >
            <span className="k">Estágio</span>
            <button
              type="button"
              onClick={() => setStagePickerOpen((v) => !v)}
              disabled={stageBusy}
              title="Mudar estágio (⌘S)"
              style={{
                background: "transparent",
                border: "none",
                padding: "2px 6px",
                margin: "-2px -6px",
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--ink)",
                fontSize: "inherit",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span className="v" style={{ pointerEvents: "none" }}>
                {stageBusy ? "…" : stageLabel}
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.5 }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {stagePickerOpen ? (
              <div
                role="listbox"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 4,
                  background: "var(--surface)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 8,
                  boxShadow: "var(--sh-pop, 0 8px 24px rgba(0,0,0,0.08))",
                  zIndex: 20,
                  minWidth: 180,
                  padding: 4,
                }}
              >
                {PIPELINE_STAGES.map((s) => {
                  const active = s === currentStage;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handlePickStage(s)}
                      disabled={stageBusy}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "6px 10px",
                        background: active ? "var(--surface-2)" : "transparent",
                        border: "none",
                        borderRadius: 6,
                        cursor: stageBusy ? "wait" : "pointer",
                        fontSize: 12.5,
                        color: active ? "var(--blue)" : "var(--ink)",
                        fontWeight: active ? 600 : 400,
                        textAlign: "left",
                      }}
                    >
                      {PIPELINE_STAGE_LABEL[s]}
                      {active ? <span style={{ fontSize: 11 }}>✓</span> : null}
                    </button>
                  );
                })}
                {stageErr ? (
                  <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--hot)" }}>
                    {stageErr}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {prazo ? (
            <div className="kv">
              <span className="k">Prazo</span>
              <span className="v">{prazo}</span>
            </div>
          ) : null}
          {priceRange ? (
            <div className="kv">
              <span className="k">Orçamento</span>
              <span className="v">{priceRange}</span>
            </div>
          ) : null}
          {origem ? (
            <div className="kv">
              <span className="k">Origem</span>
              <span className="v">{origem}</span>
            </div>
          ) : null}
          <div className="kv">
            <span className="k">Corretor</span>
            <span className="v" style={{ color: agentName ? "var(--ink)" : "var(--ink-4)" }}>
              {agentName ?? "não atribuído"}
            </span>
          </div>
        </section>

        {/* ─── Empreendimento favorito (derivado de messages.sources) ─── */}
        {topEmpreendimento ? (
          <section>
            <h4>Mais citado pela Bia</h4>
            <EmpreendimentoMini emp={topEmpreendimento} />
          </section>
        ) : null}

        {/* ─── Interesses ─── */}
        {interests.length > 0 ? (
          <section>
            <h4>Interesses</h4>
            <div className="taglist">
              {interests.map((tag) => (
                <Chip key={tag} tone="ghost">
                  {tag}
                </Chip>
              ))}
            </div>
          </section>
        ) : null}

        {/* ─── Objeções detectadas ─── */}
        {objections.length > 0 ? (
          <section>
            <h4>Objeções detectadas</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {objections.map((obj, i) => (
                <div key={i} className="objection-row">
                  <span className={`dot${obj.status === "open" ? " warm" : " muted"}`} />
                  <div>
                    <strong>{obj.label}</strong>
                    <span className="muted">
                      {" "}
                      · {obj.status === "open" ? "aberta" : "resolvida"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ─── Handoff ativo ─── */}
        {lead.handoff_notified_at && !lead.bridge_active && !lead.handoff_resolved_at ? (
          <section>
            <h4>Handoff pendente</h4>
            <div style={{ fontSize: 13, color: "var(--ink)" }}>
              {lead.handoff_urgency ? HANDOFF_URGENCY_EMOJI[lead.handoff_urgency] : "🔔"}{" "}
              <strong>
                {lead.handoff_reason
                  ? HANDOFF_REASON_LABEL[lead.handoff_reason] ?? lead.handoff_reason
                  : "handoff"}
              </strong>
              {lead.handoff_urgency ? ` · ${lead.handoff_urgency}` : null}
            </div>
            <Link
              href={`/handoff/${lead.id}`}
              className="btn sm"
              style={{ marginTop: 4, alignSelf: "flex-start" }}
            >
              Revisar handoff →
            </Link>
          </section>
        ) : null}

        {/* ─── Brief / Memória ─── */}
        {lead.brief ? (
          <section>
            <h4>Brief da Bia</h4>
            <p
              style={{
                fontSize: 12.5,
                lineHeight: 1.55,
                margin: 0,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
              }}
            >
              {lead.brief}
            </p>
          </section>
        ) : null}

        {/* ─── Ações rápidas ─── */}
        <section>
          <h4>Ações rápidas</h4>
          <div className="ctx-actions">
            <Link href={`/agenda?lead=${lead.id}`} className="btn sm" title="⌘V">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 9h18M8 3v4M16 3v4" />
                </svg>
                Agendar visita
              </span>
              <span className="kbd">⌘V</span>
            </Link>
            <button
              type="button"
              className="btn sm"
              title="Mudar estágio (⌘S)"
              onClick={() => setStagePickerOpen((v) => !v)}
              disabled={stageBusy}
              style={{ justifyContent: "space-between" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
                Mudar estágio
              </span>
              <span className="kbd">⌘S</span>
            </button>
            <Link href={`/leads/${lead.id}`} className="btn sm" title="⌘P">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
                </svg>
                Perfil do lead
              </span>
              <span className="kbd">⌘P</span>
            </Link>
          </div>
        </section>

        {/* ─── Timeline ─── */}
        <section>
          <h4>Eventos</h4>
          <Timeline leadId={lead.id} />
        </section>
      </div>
    </div>
  );
}

/**
 * Mini-card do empreendimento mais citado — nome + localização,
 * tipologias resumidas, preço e data de entrega. Link pra página
 * completa do empreendimento quando slug disponível.
 */
function EmpreendimentoMini({ emp }: { emp: TopEmpreendimento }) {
  const quartosRange = tipologiaQuartosSummary(emp.tipologias);
  const entrega = fmtEntrega(emp.entrega);
  const preco = fmtShortPrice(emp.preco_inicial);
  const location = [emp.bairro, emp.cidade].filter(Boolean).join(" · ");

  const statusLabel =
    emp.status === "lancamento"
      ? "lançamento"
      : emp.status === "em_obras"
        ? "em obras"
        : emp.status === "pronto_para_morar"
          ? "pronto"
          : null;

  const inner = (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          justifyContent: "space-between",
        }}
      >
        <strong
          style={{
            fontSize: 13,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {emp.nome}
        </strong>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--ink-4)",
            flex: "none",
          }}
        >
          {emp.citations}×
        </span>
      </div>

      {location ? (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{location}</span>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
        {quartosRange ? <Chip tone="ghost">{quartosRange}</Chip> : null}
        {preco ? <Chip tone="ghost">a partir de {preco}</Chip> : null}
        {entrega ? <Chip tone="ghost">Entrega {entrega}</Chip> : null}
        {statusLabel ? <Chip tone="ghost">{statusLabel}</Chip> : null}
      </div>
    </div>
  );

  return emp.slug ? (
    <Link
      href={`/empreendimentos/${emp.slug}`}
      className="mini-prop"
      style={{ textDecoration: "none", color: "inherit" }}
      title="Abrir empreendimento"
    >
      {inner}
    </Link>
  ) : (
    <div className="mini-prop">{inner}</div>
  );
}

function tipologiaQuartosSummary(tipologias: TopEmpreendimento["tipologias"]): string | null {
  if (!Array.isArray(tipologias) || tipologias.length === 0) return null;
  const qs = Array.from(
    new Set(
      tipologias
        .map((t) => t.quartos)
        .filter((v): v is number => typeof v === "number" && v > 0),
    ),
  ).sort((a, b) => a - b);
  if (qs.length === 0) return null;
  if (qs.length === 1) return `${qs[0]} dorms`;
  return `${qs[0]}–${qs[qs.length - 1]} dorms`;
}

function fmtEntrega(entrega: string | null): string | null {
  if (!entrega) return null;
  // Formatos tolerados: "2026-12", "2026-12-01", "12/2026"
  const m = entrega.match(/^(\d{4})-(\d{2})/);
  if (m) {
    const yy = m[1].slice(2);
    return `${m[2]}/${yy}`;
  }
  const m2 = entrega.match(/^(\d{2})\/(\d{4})/);
  if (m2) return `${m2[1]}/${m2[2].slice(2)}`;
  return entrega;
}

function fmtShortPrice(val: unknown): string | null {
  if (typeof val !== "number") return null;
  if (val >= 1_000_000) return `R$ ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `R$ ${(val / 1_000).toFixed(0)}k`;
  return `R$ ${val}`;
}
