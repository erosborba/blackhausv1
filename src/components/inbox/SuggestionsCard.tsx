"use client";

/**
 * Vanguard · Track 3 · Slice 3.6b — UI do card de sugestões copilot.
 *
 * Card lateral no /inbox (dentro do ContextRail) que lista sugestões
 * `pending` geradas pelas tools simulate_financing e check_mcmv em
 * modo copilot. Três ações por sugestão:
 *
 *   - **Enviar**: dispara `/api/suggestions/[id]/send` com o texto
 *     original de `text_preview`. Outbound grava como role="assistant"
 *     (origem Bia) porque foi a Bia quem escreveu; corretor só
 *     autorizou. Realtime atualiza o status e o card some.
 *   - **Editar**: abre um textarea pré-populado com `text_preview`.
 *     Ao confirmar, envia com `editedText` no body — a telemetria
 *     `edited_text` rastreia diferença entre texto da Bia e texto
 *     revisado pelo corretor (qualidade do output).
 *   - **Descartar**: abre dropdown de motivos (enum pra consistência;
 *     "outro" libera campo livre). POSTa em `/api/suggestions/[id]/discard`.
 *
 * Realtime:
 *   - `supabaseBrowser().channel(...).on("postgres_changes", ...)`
 *   - Subscreve INSERT/UPDATE em `copilot_suggestions` filtrado por
 *     `lead_id`. UPDATE cobre "sugestão marcada sent/discarded" →
 *     filtra no client pra mostrar só pending.
 *   - Fallback: fetch inicial via `/api/suggestions?lead_id=...` (GET
 *     não existe — então a primeira carga vai pelo INSERT do realtime).
 *     Pra robustez no load, GET é criado pra listar pending.
 *
 * Design:
 *   - Card próprio (classe `lead-card` do CSS vizinho) com header
 *     "Sugestões pendentes · N" + lista vertical de sub-cards.
 *   - Cada sub-card mostra: badge kind ("simulação" | "MCMV") +
 *     tabela resumo + texto preview + botões.
 *   - Sem scroll interno — se tiver muitas sugestões, o rail rola.
 */

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";

// ──────────────────────────────────────────────────────────────────────
// Tipos — espelham a tabela `copilot_suggestions` mas só o que a UI usa.
// ──────────────────────────────────────────────────────────────────────

type SuggestionKind = "simulation" | "mcmv";
type SuggestionStatus = "pending" | "sent" | "discarded";

type Suggestion = {
  id: string;
  lead_id: string;
  kind: SuggestionKind;
  payload: Record<string, unknown>;
  text_preview: string;
  status: SuggestionStatus;
  created_at: string;
};

/**
 * Motivos de descarte pré-definidos. "Outro" libera campo livre.
 * Armazenado em `discarded_reason` como slug (ex: "calculo_errado");
 * a telemetria agrega por esse slug.
 */
const DISCARD_REASONS = [
  { value: "calculo_errado", label: "Cálculo errado" },
  { value: "taxa_desatualizada", label: "Taxa desatualizada" },
  { value: "lead_ja_sabia", label: "Lead já sabia" },
  { value: "timing_ruim", label: "Timing ruim" },
  { value: "vou_reformular", label: "Vou reformular" },
  { value: "outro", label: "Outro…" },
] as const;

// ──────────────────────────────────────────────────────────────────────
// Hook — realtime + fetch inicial
// ──────────────────────────────────────────────────────────────────────

/**
 * Escuta sugestões pending do lead em tempo real. Fetch inicial via
 * GET /api/suggestions?lead_id= (criado em 3.6b), atualizações via
 * `postgres_changes` em copilot_suggestions.
 *
 * Retorna: lista de pending (UPDATEs pra sent/discarded removem do
 * state) + função `refetch` pra recarregar depois de ação otimista
 * que deu errado (fallback).
 */
function useCopilotSuggestions(leadId: string) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/suggestions?lead_id=${encodeURIComponent(leadId)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setSuggestions(json.data as Suggestion[]);
      }
    } catch {
      // Silencioso — realtime eventualmente entrega. Log só no server.
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void fetchInitial();
  }, [fetchInitial]);

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`suggestions:${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "copilot_suggestions",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const row = payload.new as Suggestion;
          if (row.status !== "pending") return;
          setSuggestions((prev) =>
            prev.some((s) => s.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "copilot_suggestions",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const row = payload.new as Suggestion;
          setSuggestions((prev) => {
            if (row.status === "pending") {
              // update in-place (raro — created_by/meta edit)
              return prev.map((s) => (s.id === row.id ? row : s));
            }
            // sent/discarded → remove da lista
            return prev.filter((s) => s.id !== row.id);
          });
        },
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [leadId]);

  return { suggestions, loading, refetch: fetchInitial };
}

// ──────────────────────────────────────────────────────────────────────
// Componente raiz — só renderiza se tem pending
// ──────────────────────────────────────────────────────────────────────

export function SuggestionsCard({ leadId }: { leadId: string }) {
  const { suggestions, refetch } = useCopilotSuggestions(leadId);

  if (suggestions.length === 0) return null;

  return (
    <section>
      <h4>Sugestões pendentes · {suggestions.length}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suggestions.map((s) => (
          <SuggestionItem key={s.id} suggestion={s} onDone={refetch} />
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Item individual — estado local de edição/descarte
// ──────────────────────────────────────────────────────────────────────

type ItemMode = "view" | "editing" | "discarding";

function SuggestionItem({
  suggestion,
  onDone,
}: {
  suggestion: Suggestion;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<ItemMode>("view");
  const [draft, setDraft] = useState(suggestion.text_preview);
  const [discardReason, setDiscardReason] = useState<string>("calculo_errado");
  const [discardNote, setDiscardNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindLabel = suggestion.kind === "simulation" ? "simulação" : "MCMV";

  async function handleSend(editedText?: string) {
    setBusy(true);
    setError(null);
    try {
      const body = editedText !== undefined ? { editedText } : {};
      const res = await fetch(`/api/suggestions/${suggestion.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? json.detail ?? "Falha ao enviar");
      }
      // realtime UPDATE vai remover do state; refetch é belt-and-suspenders
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    setBusy(true);
    setError(null);
    // Se o motivo é "outro" e o corretor digitou nota, usa a nota como razão;
    // senão manda o slug canônico. Slug é o que a telemetria agrega.
    const reason =
      discardReason === "outro"
        ? discardNote.trim() || "outro"
        : discardReason;
    try {
      const res = await fetch(`/api/suggestions/${suggestion.id}/discard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Falha ao descartar");
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        padding: 10,
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Header: badge kind + timestamp */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Chip tone={suggestion.kind === "mcmv" ? "warm" : "ok"}>{kindLabel}</Chip>
        <span
          style={{
            fontSize: 10.5,
            color: "var(--ink-4)",
            fontFamily: "var(--font-mono)",
            marginLeft: "auto",
          }}
        >
          {fmtTimeAgo(suggestion.created_at)}
        </span>
      </div>

      {/* Tabela resumo dos números (sem renderizar no textarea — segurança visual) */}
      <PayloadTable kind={suggestion.kind} payload={suggestion.payload} />

      {/* Corpo: texto preview OU textarea de edição OU form de descarte */}
      {mode === "editing" ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          style={{
            width: "100%",
            resize: "vertical",
            background: "var(--surface-2)",
            border: "1px solid var(--hairline-2)",
            borderRadius: 8,
            padding: "8px 10px",
            color: "var(--ink)",
            fontSize: 12.5,
            lineHeight: 1.5,
            fontFamily: "inherit",
            outline: "none",
          }}
          autoFocus
        />
      ) : mode === "discarding" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <select
            value={discardReason}
            onChange={(e) => setDiscardReason(e.target.value)}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--hairline-2)",
              borderRadius: 8,
              padding: "6px 10px",
              color: "var(--ink)",
              fontSize: 12.5,
              fontFamily: "inherit",
            }}
          >
            {DISCARD_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {discardReason === "outro" ? (
            <input
              type="text"
              value={discardNote}
              onChange={(e) => setDiscardNote(e.target.value)}
              placeholder="motivo…"
              maxLength={200}
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--hairline-2)",
                borderRadius: 8,
                padding: "6px 10px",
                color: "var(--ink)",
                fontSize: 12.5,
                fontFamily: "inherit",
              }}
            />
          ) : null}
        </div>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--ink-2)",
            whiteSpace: "pre-wrap",
          }}
        >
          {suggestion.text_preview}
        </p>
      )}

      {error ? <Chip tone="hot">{error}</Chip> : null}

      {/* Botões — muda conforme o modo */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {mode === "view" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSend()}
              disabled={busy}
            >
              {busy ? "Enviando…" : "Enviar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(suggestion.text_preview);
                setMode("editing");
              }}
              disabled={busy}
            >
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("discarding")}
              disabled={busy}
            >
              Descartar
            </Button>
          </>
        ) : mode === "editing" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSend(draft)}
              disabled={busy || draft.trim().length === 0}
            >
              {busy ? "Enviando…" : "Enviar revisado"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("view")}
              disabled={busy}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDiscard}
              disabled={busy}
            >
              {busy ? "Descartando…" : "Confirmar descarte"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("view")}
              disabled={busy}
            >
              Cancelar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tabela resumo do payload — render específico por kind
// ──────────────────────────────────────────────────────────────────────

function PayloadTable({
  kind,
  payload,
}: {
  kind: SuggestionKind;
  payload: Record<string, unknown>;
}) {
  const rows: Array<[string, string]> = [];

  if (kind === "simulation") {
    // payload: sistema, preco_imovel, entrada, prazo_meses, taxa_anual,
    //          parcela_inicial, parcela_final, total_pago
    pushRow(rows, "Sistema", fmtStr(payload.sistema));
    pushRow(rows, "Preço", fmtBRL(payload.preco_imovel));
    pushRow(rows, "Entrada", fmtBRL(payload.entrada));
    pushRow(rows, "Prazo", fmtPrazo(payload.prazo_meses));
    pushRow(rows, "Taxa", fmtTaxa(payload.taxa_anual));
    // Parcela: se inicial === final é SBPE (constante), senão SAC (mostra range).
    const pIni = payload.parcela_inicial;
    const pFim = payload.parcela_final;
    if (typeof pIni === "number" && typeof pFim === "number") {
      pushRow(
        rows,
        "Parcela",
        Math.abs(pIni - pFim) < 0.5 ? fmtBRL(pIni) : `${fmtBRL(pIni)} → ${fmtBRL(pFim)}`,
      );
    }
    pushRow(rows, "Total", fmtBRL(payload.total_pago));
  } else {
    // MCMV — band é objeto aninhado
    const band = (payload.band ?? {}) as Record<string, unknown>;
    pushRow(rows, "Faixa", fmtStr(band.label));
    pushRow(rows, "Renda", fmtBRL(payload.renda));
    pushRow(
      rows,
      "Subsídio máx",
      typeof band.subsidyMax === "number" && band.subsidyMax > 0
        ? fmtBRL(band.subsidyMax)
        : "—",
    );
    pushRow(
      rows,
      "Teto imóvel",
      typeof band.maxPropertyValue === "number" ? fmtBRL(band.maxPropertyValue) : "—",
    );
    pushRow(
      rows,
      "1º imóvel",
      payload.primeiro_imovel === true
        ? "sim"
        : payload.primeiro_imovel === false
          ? "não"
          : "—",
    );
  }

  if (rows.length === 0) return null;

  return (
    <dl
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "3px 10px",
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--ink-4)", letterSpacing: "0.04em" }}>{k}</dt>
          <dd style={{ margin: 0, color: "var(--ink)" }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers de formatação — locais, não puxam libs externas
// ──────────────────────────────────────────────────────────────────────

function pushRow(rows: Array<[string, string]>, k: string, v: string | null) {
  if (v === null || v === "") return;
  rows.push([k, v]);
}

function fmtStr(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v;
}

function fmtBRL(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // Sem decimais pra valores altos (≥ 1k); duas casas pra parcelas baixas.
  if (v >= 1000) {
    return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  }
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPrazo(v: unknown): string | null {
  if (typeof v !== "number") return null;
  const anos = Math.round(v / 12);
  return `${v} meses (${anos} anos)`;
}

function fmtTaxa(v: unknown): string | null {
  if (typeof v !== "number") return null;
  // taxa_anual é fração (0.115 = 11.5%)
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% a.a.`;
}

function fmtTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
