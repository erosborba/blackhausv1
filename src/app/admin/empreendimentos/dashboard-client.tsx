"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  computeGaps,
  type Empreendimento,
  type Faq,
  type Gap,
  type Midia,
  type Tipologia,
} from "@/lib/empreendimentos-shared";

/**
 * Dashboard de empreendimentos (modo leitura) — sidebar + painel principal.
 *
 * Inspirado em `exemplos/empreendimentos.jsx`: lista à esquerda, detalhe rico
 * à direita (capa, visão geral, tipologias com planta estilizada, diferenciais,
 * base de conhecimento da IA, materiais).
 *
 * Edição ainda mora em `/admin/empreendimentos/[id]` — botão "Editar" no topo
 * do detalhe leva pra lá. Criação idem via "+ Novo".
 *
 * Upload de documentos é inline aqui mesmo (botão "✨ Adicionar documentos"):
 * usa o mesmo endpoint `/docs` do detail, mas atualiza o estado local sem
 * navegar. Assim o corretor consegue alimentar a Bia sem sair do dashboard.
 */

// ─── Paleta / utils ──────────────────────────────────────────────────────────
const BG_0 = "#0b0b0d";
const BG_1 = "#15151a";
const BG_2 = "#1a1a20";
const LINE = "#2a2a32";
const LINE_STRONG = "#3a3a44";
const TEXT_0 = "#e7e7ea";
const TEXT_1 = "#c0c0c8";
const TEXT_2 = "#9a9aa4";
const TEXT_3 = "#6f6f78";
const COPPER_200 = "#e8b98a";
const COPPER_300 = "#d99558";
const COPPER_400 = "#b67840";

const fmtBRL = (n?: number | null) =>
  typeof n === "number"
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : "sob consulta";

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  // Aceita "YYYY-MM-DD" ou ISO.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
};

function statusMeta(status: Empreendimento["status"]) {
  switch (status) {
    case "lancamento":
      return { label: "Lançamento", bg: "#1e2b3a", fg: "#8cb4e8" };
    case "em_obras":
      return { label: "Em obras", bg: "#2b2e1e", fg: "#d9cf6b" };
    case "pronto_para_morar":
      return { label: "Pronto", bg: "#1e3a2b", fg: "#6bd99b" };
    default:
      return { label: "—", bg: "#2a2a32", fg: "#8f8f9a" };
  }
}

function coverGradient(nome: string): string {
  // Gradient determinístico por hash simples do nome — garante que cada
  // empreendimento tem uma capa "própria" mesmo sem imagem real.
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) | 0;
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 25% 18%), hsl(${hue2} 30% 12%))`;
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "320px 1fr",
  minHeight: "100vh",
  background: BG_0,
};

const sidebar: CSSProperties = {
  borderRight: `1px solid ${LINE}`,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const sidebarHeader: CSSProperties = {
  padding: "18px 16px 14px",
  borderBottom: `1px solid ${LINE}`,
};

const sidebarList: CSSProperties = {
  overflowY: "auto",
  padding: "10px 10px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
};

const sidebarItem = (active: boolean): CSSProperties => ({
  display: "flex",
  gap: 12,
  padding: 10,
  borderRadius: 10,
  border: active ? "1px solid rgba(217,149,88,0.35)" : "1px solid transparent",
  background: active
    ? "linear-gradient(90deg, rgba(217,149,88,0.12), transparent)"
    : "transparent",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
  color: "inherit",
  transition: "background 120ms, border-color 120ms",
});

const thumb = (bg: string): CSSProperties => ({
  width: 52,
  height: 52,
  borderRadius: 8,
  background: bg,
  flexShrink: 0,
  boxShadow: "inset 0 0 0 1px rgba(255,235,205,0.08)",
});

const mainPane: CSSProperties = {
  overflowY: "auto",
  minHeight: 0,
};

const cover = (gradient: string): CSSProperties => ({
  height: 220,
  position: "relative",
  display: "flex",
  alignItems: "flex-end",
  padding: "24px 28px",
  background: gradient,
});

const coverOverlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, rgba(10,8,6,0) 0%, rgba(10,8,6,0.92) 100%)",
  pointerEvents: "none",
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
  padding: "22px 28px 32px",
};

const box: CSSProperties = {
  background: BG_1,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: "14px 16px",
  minWidth: 0,
};

const boxWide: CSSProperties = { ...box, gridColumn: "span 2" };

const boxAi: CSSProperties = {
  ...boxWide,
  background: `linear-gradient(135deg, rgba(245,185,122,0.06), ${BG_1})`,
  borderColor: "rgba(245,185,122,0.22)",
};

const caps: CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: 0.7,
  color: TEXT_3,
  marginBottom: 12,
  display: "block",
  fontWeight: 500,
};

const kvRow = (highlight = false, last = false): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingBottom: 8,
  borderBottom: last ? "none" : `1px solid ${LINE}`,
  fontSize: 13,
  marginBottom: last ? 0 : 8,
  color: highlight ? COPPER_200 : TEXT_0,
});

const chip = (bg: string, fg: string, soft = false): CSSProperties => ({
  background: soft ? `${bg}33` : bg,
  color: fg,
  padding: "3px 9px",
  borderRadius: 4,
  fontSize: 11,
  display: "inline-flex",
  alignItems: "center",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 500,
  border: soft ? `1px solid ${bg}55` : "none",
});

const btn = (variant: "primary" | "ghost" | "ai" = "ghost"): CSSProperties => {
  if (variant === "primary") {
    return {
      background: COPPER_300,
      color: "#1a0f06",
      border: "none",
      borderRadius: 8,
      padding: "9px 16px",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "inherit",
    };
  }
  if (variant === "ai") {
    return {
      background: "rgba(245,185,122,0.10)",
      color: COPPER_200,
      border: "1px solid rgba(245,185,122,0.30)",
      borderRadius: 8,
      padding: "9px 16px",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      fontFamily: "inherit",
    };
  }
  return {
    background: "transparent",
    color: TEXT_1,
    border: `1px solid ${LINE_STRONG}`,
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  };
};

// ─── Componente ──────────────────────────────────────────────────────────────

export function EmpreendimentosDashboard({ initial }: { initial: Empreendimento[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Empreendimento[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.length > 0 ? initial[0].id : null,
  );
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lastChange, setLastChange] = useState<
    { id: string; added: number; changed: string[] } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // FAQs são lazy-loaded por empreendimento — cache em memória pra não refetch
  // toda vez que o corretor volta pra mesma tela. Invalidamos após mutações.
  const [faqsByEmp, setFaqsByEmp] = useState<Record<string, Faq[]>>({});
  const [faqLoading, setFaqLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((e) =>
      [e.nome, e.bairro, e.cidade, e.construtora]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [items, search]);

  const selected = useMemo(
    () => items.find((e) => e.id === selectedId) ?? filtered[0] ?? null,
    [items, selectedId, filtered],
  );

  const docCount = useMemo(() => items.reduce((acc, e) => acc + (e.midias?.length ?? 0), 0), [items]);

  // Carrega FAQ do empreendimento selecionado. Cache por id; refetch só na
  // primeira visita ou após invalidação manual (add/edit/delete).
  useEffect(() => {
    if (!selected) return;
    if (faqsByEmp[selected.id]) return;
    let cancelled = false;
    setFaqLoading(true);
    fetch(`/api/admin/empreendimentos/${selected.id}/faqs`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.ok) {
          setFaqsByEmp((cur) => ({ ...cur, [selected.id]: json.data as Faq[] }));
        }
      })
      .catch((e) => console.error("[faqs] load failed:", e))
      .finally(() => {
        if (!cancelled) setFaqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, faqsByEmp]);

  async function handleAddFaq(
    empId: string,
    question: string,
    answer: string,
    source: "manual" | "ai_generated" = "manual",
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/faqs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, answer, source }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : "Falha ao salvar FAQ");
      setFaqsByEmp((cur) => ({
        ...cur,
        [empId]: [...(cur[empId] ?? []), json.data as Faq],
      }));
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /**
   * Pede sugestões de FAQ pra IA. Não persiste — retorna as proposals pro
   * painel de revisão do FaqSection decidir o que aprovar.
   */
  async function handleSuggestFaqs(
    empId: string,
  ): Promise<{ question: string; answer: string }[]> {
    const res = await fetch(`/api/admin/empreendimentos/${empId}/faqs/suggest`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(typeof json.error === "string" ? json.error : "Falha ao gerar sugestões");
    }
    return Array.isArray(json.proposals) ? json.proposals : [];
  }

  /**
   * Aprova várias FAQs de uma vez. Usa o endpoint bulk que faz UM reindex
   * awaited — evita race condition de várias reindexações concorrentes
   * quando se aprovava sugestão por sugestão com POST single fire-and-forget.
   */
  async function handleReindex(empId: string): Promise<void> {
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/reindex`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha no reindex");
      }
      alert(`RAG reindexado: ${json.indexed ?? 0} chunks gerados.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleBulkApproveFaqs(
    empId: string,
    faqs: { question: string; answer: string; source?: "manual" | "ai_generated" }[],
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/faqs/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ faqs }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao aprovar sugestões");
      }
      const newFaqs = Array.isArray(json.data) ? (json.data as Faq[]) : [];
      setFaqsByEmp((cur) => ({
        ...cur,
        [empId]: [...(cur[empId] ?? []), ...newFaqs],
      }));
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function handleUpdateFaq(empId: string, faqId: string, patch: Partial<Faq>): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/faqs/${faqId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : "Falha ao editar FAQ");
      setFaqsByEmp((cur) => ({
        ...cur,
        [empId]: (cur[empId] ?? []).map((f) => (f.id === faqId ? (json.data as Faq) : f)),
      }));
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function handleDeleteFaq(empId: string, faqId: string): Promise<void> {
    if (!confirm("Remover esta FAQ?")) return;
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/faqs/${faqId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : "Falha ao remover FAQ");
      setFaqsByEmp((cur) => ({
        ...cur,
        [empId]: (cur[empId] ?? []).filter((f) => f.id !== faqId),
      }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteEmp(empId: string, nome: string) {
    if (!confirm(`Excluir "${nome}"?\n\nIsso remove o empreendimento, FAQs, chunks do RAG e arquivos do storage. Leads que referenciam este empreendimento são preservados (só perdem o link).`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : "Falha ao excluir");
      // Remove do state + seleciona o próximo. Sem item? null.
      setItems((arr) => {
        const next = arr.filter((e) => e.id !== empId);
        // Se o deletado era o selecionado, avança pro primeiro restante.
        if (selectedId === empId) setSelectedId(next[0]?.id ?? null);
        return next;
      });
      // Limpa caches associados.
      setFaqsByEmp((cur) => {
        const { [empId]: _removed, ...rest } = cur;
        void _removed;
        return rest;
      });
      if (lastChange?.id === empId) setLastChange(null);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteMidia(empId: string, midia: Midia) {
    if (!confirm(`Remover "${midia.name}"?\n\nO arquivo é apagado do storage. O conhecimento já extraído dele continua disponível pra Bia (edite o empreendimento pra limpar também se precisar).`)) {
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/empreendimentos/${empId}/docs/${encodeURIComponent(midia.path)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : "Falha ao remover");
      setItems((arr) => arr.map((e) => (e.id === empId ? (json.data as Empreendimento) : e)));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAddDocs(files: FileList | null) {
    if (!files || files.length === 0 || !selected) return;
    setUploading(true);
    setLastChange(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch(`/api/admin/empreendimentos/${selected.id}/docs`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha no upload");
      }
      // Atualiza item local.
      setItems((arr) => arr.map((e) => (e.id === selected.id ? (json.data as Empreendimento) : e)));
      setLastChange({
        id: selected.id,
        added: Array.isArray(json.uploaded) ? json.uploaded.length : 0,
        changed: Array.isArray(json.changed) ? json.changed : [],
      });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div style={layout}>
      {/* ── Sidebar ───────────────────────────────────── */}
      <aside style={sidebar}>
        <div style={sidebarHeader}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Link
              href="/admin/leads"
              style={{ color: TEXT_3, textDecoration: "none", fontSize: 12 }}
            >
              ← Inbox
            </Link>
            <Link href="/admin/empreendimentos/new" style={{ ...btn("primary"), textDecoration: "none", padding: "6px 12px", fontSize: 12 }}>
              + Novo
            </Link>
          </div>
          <h1 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em", color: TEXT_0 }}>
            Empreendimentos
          </h1>
          <div style={{ fontSize: 11.5, color: TEXT_3, marginTop: 4 }}>
            {items.length} ativo{items.length === 1 ? "" : "s"} · {docCount} doc{docCount === 1 ? "" : "s"} na base da Bia
          </div>
          <input
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              marginTop: 12,
              width: "100%",
              background: BG_0,
              border: `1px solid ${LINE}`,
              borderRadius: 8,
              padding: "7px 10px",
              color: TEXT_0,
              fontSize: 12.5,
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={sidebarList}>
          {filtered.length === 0 ? (
            <div style={{ color: TEXT_3, fontSize: 12, padding: "20px 10px", textAlign: "center" }}>
              {items.length === 0 ? "Nenhum empreendimento ainda." : "Nenhum resultado."}
            </div>
          ) : (
            filtered.map((e) => {
              const active = e.id === selected?.id;
              const sm = statusMeta(e.status);
              const tipoCount = Array.isArray(e.tipologias) ? e.tipologias.length : 0;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  style={sidebarItem(active)}
                >
                  <div style={thumb(coverGradient(e.nome))} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: TEXT_0,
                        letterSpacing: "-0.005em",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {e.nome}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_3, marginTop: 2 }}>
                      {[e.bairro, e.cidade].filter(Boolean).join(", ") || "sem localização"}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                      <span style={chip(sm.bg, sm.fg, true)}>{sm.label}</span>
                      <span style={{ fontSize: 10.5, color: TEXT_2, fontFamily: "ui-monospace, monospace" }}>
                        {tipoCount} tipo{tipoCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────── */}
      <main style={mainPane}>
        {selected ? (
          <DetailView
            emp={selected}
            onUploadClick={() => fileInputRef.current?.click()}
            uploading={uploading}
            lastChange={lastChange?.id === selected.id ? lastChange : null}
            faqs={faqsByEmp[selected.id] ?? []}
            faqLoading={faqLoading && !faqsByEmp[selected.id]}
            onAddFaq={(q, a, source) => handleAddFaq(selected.id, q, a, source)}
            onUpdateFaq={(faqId, patch) => handleUpdateFaq(selected.id, faqId, patch)}
            onDeleteFaq={(faqId) => handleDeleteFaq(selected.id, faqId)}
            onSuggestFaqs={() => handleSuggestFaqs(selected.id)}
            onBulkApproveFaqs={(faqs) => handleBulkApproveFaqs(selected.id, faqs)}
            onReindex={() => handleReindex(selected.id)}
            onDeleteEmp={() => handleDeleteEmp(selected.id, selected.nome)}
            onDeleteMidia={(m) => handleDeleteMidia(selected.id, m)}
          />
        ) : (
          <div style={{ padding: 40, color: TEXT_3, textAlign: "center" }}>
            Cadastre o primeiro empreendimento para começar.
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,image/*"
          onChange={(e) => handleAddDocs(e.target.files)}
          style={{ display: "none" }}
        />
      </main>
    </div>
  );
}

// ─── Detalhe (modo leitura) ──────────────────────────────────────────────────

function DetailView({
  emp,
  onUploadClick,
  uploading,
  lastChange,
  faqs,
  faqLoading,
  onAddFaq,
  onUpdateFaq,
  onDeleteFaq,
  onSuggestFaqs,
  onBulkApproveFaqs,
  onReindex,
  onDeleteEmp,
  onDeleteMidia,
}: {
  emp: Empreendimento;
  onUploadClick: () => void;
  uploading: boolean;
  lastChange: { added: number; changed: string[] } | null;
  faqs: Faq[];
  faqLoading: boolean;
  onAddFaq: (
    question: string,
    answer: string,
    source?: "manual" | "ai_generated",
  ) => Promise<boolean>;
  onUpdateFaq: (faqId: string, patch: Partial<Faq>) => Promise<boolean>;
  onDeleteFaq: (faqId: string) => Promise<void>;
  onSuggestFaqs: () => Promise<{ question: string; answer: string }[]>;
  onBulkApproveFaqs: (
    faqs: { question: string; answer: string; source?: "manual" | "ai_generated" }[],
  ) => Promise<boolean>;
  onReindex: () => Promise<void>;
  onDeleteEmp: () => Promise<void>;
  onDeleteMidia: (m: Midia) => Promise<void>;
}) {
  const sm = statusMeta(emp.status);
  const tipologias: Tipologia[] = Array.isArray(emp.tipologias) ? emp.tipologias : [];
  const diferenciais: string[] = Array.isArray(emp.diferenciais) ? emp.diferenciais : [];
  const lazer: string[] = Array.isArray(emp.lazer) ? emp.lazer : [];
  const midias: Midia[] = Array.isArray(emp.midias) ? emp.midias : [];
  const rawCount = Array.isArray(emp.raw_knowledge) ? emp.raw_knowledge.length : 0;
  const gaps = useMemo(() => computeGaps(emp, faqs.length), [emp, faqs.length]);

  // Faixa de preço: se temos preço em tipologias, pega min/max; senão usa preco_inicial.
  const precos = tipologias.map((t) => t.preco).filter((p): p is number => typeof p === "number" && p > 0);
  const precoMin = precos.length ? Math.min(...precos) : emp.preco_inicial ?? null;
  const precoMax = precos.length ? Math.max(...precos) : null;
  const faixaPreco =
    precoMin !== null && precoMax !== null && precoMax !== precoMin
      ? `${fmtBRL(precoMin)} – ${fmtBRL(precoMax)}`
      : precoMin !== null
        ? `a partir de ${fmtBRL(precoMin)}`
        : "sob consulta";

  return (
    <>
      {/* Capa */}
      <div style={cover(coverGradient(emp.nome))}>
        <div style={coverOverlay} />
        <div style={{ position: "relative", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
            <div>
              <span style={chip(sm.bg, sm.fg)}>{sm.label}</span>
              <h2
                style={{
                  margin: "10px 0 6px",
                  fontSize: 34,
                  color: TEXT_0,
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                  fontWeight: 500,
                }}
              >
                {emp.nome}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT_1 }}>
                <span>📍 {[emp.bairro, emp.cidade].filter(Boolean).join(", ") || "sem localização"}</span>
                {emp.construtora && (
                  <>
                    <span style={{ color: TEXT_3 }}>·</span>
                    <span>{emp.construtora}</span>
                  </>
                )}
                {emp.entrega && (
                  <>
                    <span style={{ color: TEXT_3 }}>·</span>
                    <span>Entrega {fmtDate(emp.entrega)}</span>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onUploadClick}
                disabled={uploading}
                style={{ ...btn("ai"), opacity: uploading ? 0.5 : 1 }}
              >
                {uploading ? "Extraindo…" : "✨ Adicionar documentos"}
              </button>
              <Link
                href={`/admin/empreendimentos/${emp.id}`}
                style={{ ...btn("ghost"), textDecoration: "none", display: "inline-block" }}
              >
                Editar
              </Link>
              <button
                onClick={onDeleteEmp}
                style={{
                  ...btn("ghost"),
                  color: "#e08a8a",
                  borderColor: "rgba(217,90,90,0.35)",
                }}
                title="Excluir empreendimento"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Banner de enriquecimento */}
      {lastChange && (
        <div
          style={{
            margin: "18px 28px 0",
            padding: "10px 14px",
            background: "rgba(107,217,155,0.08)",
            border: "1px solid rgba(107,217,155,0.25)",
            borderRadius: 10,
            color: "#6bd99b",
            fontSize: 13,
          }}
        >
          ✓ {lastChange.added} documento{lastChange.added === 1 ? "" : "s"} indexado{lastChange.added === 1 ? "" : "s"}.{" "}
          {lastChange.changed.length === 0
            ? "Nenhum campo novo extraído (o conteúdo bruto está disponível no RAG)."
            : `Campos enriquecidos: ${lastChange.changed.join(", ")}.`}
        </div>
      )}

      {/* Grid de cards */}
      <div style={grid}>
        {/* Visão geral */}
        <div style={box}>
          <span style={caps}>Visão geral</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={kvRow()}>
              <span style={{ color: TEXT_3 }}>Tipologias</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {tipologias.length || "—"}
              </span>
            </div>
            <div style={kvRow(true)}>
              <span style={{ color: TEXT_3 }}>Faixa de preço</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{faixaPreco}</span>
            </div>
            <div style={kvRow()}>
              <span style={{ color: TEXT_3 }}>Entrega</span>
              <span>{fmtDate(emp.entrega)}</span>
            </div>
            <div style={kvRow()}>
              <span style={{ color: TEXT_3 }}>Incorporadora</span>
              <span>{emp.construtora ?? "—"}</span>
            </div>
            <div style={kvRow(false, true)}>
              <span style={{ color: TEXT_3 }}>Endereço</span>
              <span
                style={{
                  maxWidth: "60%",
                  textAlign: "right",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={emp.endereco ?? ""}
              >
                {emp.endereco ?? "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Tipologias */}
        <div style={box}>
          <span style={caps}>Tipologias</span>
          {tipologias.length === 0 ? (
            <div style={{ color: TEXT_3, fontSize: 12 }}>Sem tipologias cadastradas.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
              {tipologias.map((t, i) => (
                <div
                  key={i}
                  style={{
                    padding: 10,
                    border: `1px solid ${LINE}`,
                    borderRadius: 8,
                    background: "rgba(255,235,205,0.015)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ height: 60, marginBottom: 8 }}>
                    <svg viewBox="0 0 100 80" width="100%" height="100%">
                      <rect x="2" y="2" width="96" height="76" fill="none" stroke="rgba(217,149,88,0.35)" strokeWidth={1} />
                      <rect x="8" y="8" width="40" height="30" fill="rgba(217,149,88,0.08)" stroke="rgba(217,149,88,0.3)" />
                      <rect x="52" y="8" width="40" height="30" fill="rgba(217,149,88,0.05)" stroke="rgba(217,149,88,0.3)" />
                      <rect x="8" y="42" width="84" height="30" fill="rgba(217,149,88,0.04)" stroke="rgba(217,149,88,0.3)" />
                      <line x1="50" y1="8" x2="50" y2="38" stroke="rgba(217,149,88,0.3)" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 11.5, color: TEXT_1, fontWeight: 500, marginBottom: 2 }}>
                    {t.quartos != null ? `${t.quartos} ${t.quartos === 1 ? "quarto" : "quartos"}` : "Studio"}
                  </div>
                  <div style={{ fontSize: 10.5, color: TEXT_3, fontFamily: "ui-monospace, monospace" }}>
                    {t.area ? `${t.area}m²` : "—"}
                    {t.preco ? ` · ${fmtBRL(t.preco)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Diferenciais */}
        <div style={boxWide}>
          <span style={caps}>Diferenciais</span>
          {diferenciais.length === 0 && lazer.length === 0 ? (
            <div style={{ color: TEXT_3, fontSize: 12 }}>Sem diferenciais cadastrados.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
              {[...diferenciais, ...lazer].map((d, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: TEXT_1 }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: COPPER_400,
                      flexShrink: 0,
                    }}
                  />
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Base da IA */}
        <div style={boxAi}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: COPPER_200,
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: COPPER_300,
                  boxShadow: "0 0 10px rgba(245,185,122,0.6)",
                }}
              />
              Base de conhecimento da IA
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={chip("#1e3a2b", "#6bd99b", true)}>
                {midias.length > 0 ? "sincronizada" : "vazia"}
              </span>
              <ReindexButton onReindex={onReindex} />
            </div>
          </div>
          <div style={{ fontSize: 13, color: TEXT_1, lineHeight: 1.55 }}>
            A Bia consulta{" "}
            <strong style={{ color: COPPER_200, fontWeight: 500 }}>
              {midias.length} documento{midias.length === 1 ? "" : "s"}
            </strong>
            ,{" "}
            <strong style={{ color: COPPER_200, fontWeight: 500 }}>
              {rawCount} bloco{rawCount === 1 ? "" : "s"} bruto{rawCount === 1 ? "" : "s"}
            </strong>
            {" "}e{" "}
            <strong style={{ color: COPPER_200, fontWeight: 500 }}>
              {faqs.length} FAQ{faqs.length === 1 ? "" : "s"}
            </strong>
            {" "}pra responder sobre este empreendimento. Conteúdo estruturado extraído automaticamente quando você adiciona documentos.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px dashed rgba(245,185,122,0.2)",
            }}
          >
            <Stat value={midias.length} label="documentos" />
            <Stat value={rawCount} label="blocos brutos" />
            <Stat
              value={tipologias.length + diferenciais.length + lazer.length}
              label="dados estruturados"
            />
            <Stat value={faqs.length} label={`FAQ${faqs.length === 1 ? "" : "s"}`} />
          </div>

          {gaps.length > 0 && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px dashed rgba(245,185,122,0.2)",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: 0.7,
                  color: TEXT_3,
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                Lacunas ({gaps.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {gaps.map((g) => (
                  <GapBadge key={g.field} gap={g} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Descrição */}
        {emp.descricao && (
          <div style={boxWide}>
            <span style={caps}>Descrição</span>
            <div style={{ fontSize: 13, color: TEXT_1, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {emp.descricao}
            </div>
          </div>
        )}

        {/* Materiais */}
        <div style={boxWide}>
          <span style={caps}>Materiais ({midias.length})</span>
          {midias.length === 0 ? (
            <div style={{ color: TEXT_3, fontSize: 12 }}>
              Nenhum material anexado. Use <strong>Adicionar documentos</strong> no topo.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 4 }}>
              {midias.map((m, i) => {
                const icon =
                  m.type === "pdf"
                    ? "📄"
                    : m.type === "sheet"
                      ? "📊"
                      : m.type === "image"
                        ? "🖼️"
                        : "📎";
                return (
                  <div
                    key={`${m.path}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 6px 4px 10px",
                      borderRadius: 7,
                      transition: "background 100ms",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,235,205,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <a
                      href={`/api/admin/empreendimentos/${emp.id}/docs/${encodeURIComponent(m.path)}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        color: TEXT_1,
                        textDecoration: "none",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: "rgba(217,149,88,0.08)",
                          color: COPPER_200,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontSize: 14,
                        }}
                      >
                        {icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            color: TEXT_0,
                          }}
                          title={m.name}
                        >
                          {m.name}
                        </div>
                        <div style={{ fontSize: 10.5, color: TEXT_3 }}>
                          {(m.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                    </a>
                    <button
                      onClick={() => onDeleteMidia(m)}
                      style={{ ...iconBtn, color: "#e08a8a", flexShrink: 0 }}
                      title="Remover arquivo"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* FAQ */}
        <div style={boxWide}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ ...caps, marginBottom: 0 }}>
              FAQ ({faqs.length})
            </span>
            <span style={{ fontSize: 11, color: TEXT_3 }}>
              Perguntas frequentes que a Bia usa no RAG.
            </span>
          </div>
          <FaqSection
            faqs={faqs}
            loading={faqLoading}
            onAdd={onAddFaq}
            onUpdate={onUpdateFaq}
            onDelete={onDeleteFaq}
            onSuggest={onSuggestFaqs}
            onBulkApprove={onBulkApproveFaqs}
          />
        </div>
      </div>
    </>
  );
}

// ─── Gaps badge ──────────────────────────────────────────────────────────────

function GapBadge({ gap }: { gap: Gap }) {
  const palette =
    gap.severity === "high"
      ? { bg: "rgba(217,90,90,0.12)", fg: "#e08a8a", border: "rgba(217,90,90,0.35)" }
      : gap.severity === "medium"
        ? { bg: "rgba(217,181,90,0.10)", fg: "#d9cf6b", border: "rgba(217,181,90,0.30)" }
        : { bg: "rgba(160,160,170,0.08)", fg: TEXT_2, border: "rgba(160,160,170,0.25)" };
  return (
    <span
      title={gap.hint ?? gap.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11.5,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        fontWeight: 500,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 999, background: palette.fg }} />
      {gap.label}
    </span>
  );
}

// ─── FAQ section ─────────────────────────────────────────────────────────────

type Proposal = { question: string; answer: string; selected: boolean };

function FaqSection({
  faqs,
  loading,
  onAdd,
  onUpdate,
  onDelete,
  onSuggest,
  onBulkApprove,
}: {
  faqs: Faq[];
  loading: boolean;
  onAdd: (
    question: string,
    answer: string,
    source?: "manual" | "ai_generated",
  ) => Promise<boolean>;
  onUpdate: (faqId: string, patch: Partial<Faq>) => Promise<boolean>;
  onDelete: (faqId: string) => Promise<void>;
  onSuggest: () => Promise<{ question: string; answer: string }[]>;
  onBulkApprove: (
    faqs: { question: string; answer: string; source?: "manual" | "ai_generated" }[],
  ) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Painel de sugestões IA. Proposals ficam locais até o corretor aprovar;
  // aí viram FAQ real via onAdd(source="ai_generated").
  const [suggesting, setSuggesting] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [approving, setApproving] = useState(false);

  async function submitNew() {
    if (busy) return;
    const q = newQ.trim();
    const a = newA.trim();
    if (q.length < 3 || a.length < 3) {
      alert("Pergunta e resposta precisam de pelo menos 3 caracteres.");
      return;
    }
    setBusy(true);
    const ok = await onAdd(q, a, "manual");
    setBusy(false);
    if (ok) {
      setNewQ("");
      setNewA("");
      setAdding(false);
    }
  }

  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const list = await onSuggest();
      if (!list.length) {
        alert("A IA não encontrou novas perguntas relevantes — o cadastro já está bem coberto ou a base de conhecimento é pobre. Suba mais docs e tente de novo.");
        setProposals(null);
        return;
      }
      setProposals(list.map((p) => ({ ...p, selected: true })));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  async function approveSelected() {
    if (!proposals || approving) return;
    const picked = proposals.filter((p) => p.selected && p.question.trim() && p.answer.trim());
    if (picked.length === 0) {
      alert("Nenhuma sugestão selecionada.");
      return;
    }
    setApproving(true);
    // Bulk endpoint: um único insert + um único reindex awaited. Quando
    // voltar, RAG está consistente — Bia consegue achar as FAQs novas
    // já na próxima pergunta.
    const ok = await onBulkApprove(
      picked.map((p) => ({
        question: p.question.trim(),
        answer: p.answer.trim(),
        source: "ai_generated",
      })),
    );
    setApproving(false);
    if (ok) setProposals(null);
  }

  return (
    <div>
      {loading && faqs.length === 0 ? (
        <div style={{ color: TEXT_3, fontSize: 12 }}>Carregando FAQs…</div>
      ) : faqs.length === 0 && !adding ? (
        <div style={{ color: TEXT_3, fontSize: 12 }}>
          Nenhuma FAQ ainda. Adicione perguntas que clientes repetem.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {faqs.map((f) => (
            <FaqItem
              key={f.id}
              faq={f}
              editing={editingId === f.id}
              onStartEdit={() => setEditingId(f.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={async (patch) => {
                const ok = await onUpdate(f.id, patch);
                if (ok) setEditingId(null);
                return ok;
              }}
              onDelete={() => onDelete(f.id)}
            />
          ))}
        </div>
      )}

      {adding ? (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            border: `1px dashed ${LINE_STRONG}`,
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <input
            autoFocus
            placeholder="Pergunta (ex: tem pet place?)"
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            style={inputStyle}
          />
          <textarea
            placeholder="Resposta"
            value={newA}
            onChange={(e) => setNewA(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={() => {
                setAdding(false);
                setNewQ("");
                setNewA("");
              }}
              style={btn("ghost")}
              disabled={busy}
            >
              Cancelar
            </button>
            <button onClick={submitNew} style={btn("primary")} disabled={busy}>
              {busy ? "Salvando…" : "Adicionar"}
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: faqs.length === 0 ? 12 : 10,
            flexWrap: "wrap",
          }}
        >
          <button onClick={() => setAdding(true)} style={btn("ghost")}>
            + Nova FAQ
          </button>
          <button
            onClick={handleSuggest}
            style={{ ...btn("ai"), opacity: suggesting ? 0.6 : 1 }}
            disabled={suggesting}
            title="A IA varre o conteúdo cadastrado e propõe FAQs novas pra você revisar."
          >
            {suggesting ? "Analisando conteúdo…" : "✨ Sugerir com IA"}
          </button>
        </div>
      )}

      {/* Painel de sugestões IA — fica aberto até o corretor aprovar ou descartar. */}
      {proposals && (
        <FaqSuggestPanel
          proposals={proposals}
          busy={approving}
          onChange={setProposals}
          onApprove={approveSelected}
          onDiscard={() => setProposals(null)}
        />
      )}
    </div>
  );
}

function FaqSuggestPanel({
  proposals,
  busy,
  onChange,
  onApprove,
  onDiscard,
}: {
  proposals: Proposal[];
  busy: boolean;
  onChange: (next: Proposal[]) => void;
  onApprove: () => Promise<void>;
  onDiscard: () => void;
}) {
  const selectedCount = proposals.filter((p) => p.selected).length;

  function update(idx: number, patch: Partial<Proposal>) {
    onChange(proposals.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function toggleAll(selected: boolean) {
    onChange(proposals.map((p) => ({ ...p, selected })));
  }

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        border: "1px solid rgba(245,185,122,0.25)",
        borderRadius: 10,
        background: "linear-gradient(180deg, rgba(245,185,122,0.06), rgba(245,185,122,0.02))",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: COPPER_300,
              boxShadow: "0 0 10px rgba(245,185,122,0.6)",
            }}
          />
          <span style={{ fontSize: 12.5, color: COPPER_200, fontWeight: 500 }}>
            {proposals.length} sugestões da IA
          </span>
          <span style={{ fontSize: 11, color: TEXT_3 }}>
            · edite antes de aprovar se quiser
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => toggleAll(selectedCount !== proposals.length)}
            style={{ ...btn("ghost"), padding: "6px 10px", fontSize: 11 }}
            disabled={busy}
          >
            {selectedCount === proposals.length ? "Desmarcar todas" : "Selecionar todas"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {proposals.map((p, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${p.selected ? "rgba(245,185,122,0.25)" : LINE}`,
              background: p.selected ? "rgba(255,235,205,0.015)" : "transparent",
              opacity: p.selected ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={p.selected}
              onChange={(e) => update(i, { selected: e.target.checked })}
              disabled={busy}
              style={{ marginTop: 3, accentColor: COPPER_300, flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={p.question}
                onChange={(e) => update(i, { question: e.target.value })}
                disabled={busy || !p.selected}
                style={{ ...inputStyle, fontWeight: 500 }}
                placeholder="Pergunta"
              />
              <textarea
                value={p.answer}
                onChange={(e) => update(i, { answer: e.target.value })}
                disabled={busy || !p.selected}
                rows={2}
                style={{ ...inputStyle, resize: "vertical", minHeight: 48, fontSize: 12.5 }}
                placeholder="Resposta"
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button onClick={onDiscard} style={btn("ghost")} disabled={busy}>
          Descartar tudo
        </button>
        <button onClick={onApprove} style={btn("primary")} disabled={busy || selectedCount === 0}>
          {busy
            ? "Aprovando e indexando…"
            : `Aprovar ${selectedCount} sugest${selectedCount === 1 ? "ão" : "ões"}`}
        </button>
      </div>
    </div>
  );
}

function FaqItem({
  faq,
  editing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  faq: Faq;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<Faq>) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [q, setQ] = useState(faq.question);
  const [a, setA] = useState(faq.answer);
  const [busy, setBusy] = useState(false);

  // Sincroniza estado local se a prop mudar (ex: após update remoto).
  useEffect(() => {
    if (!editing) {
      setQ(faq.question);
      setA(faq.answer);
    }
  }, [faq.question, faq.answer, editing]);

  if (editing) {
    return (
      <div
        style={{
          padding: 12,
          border: `1px solid ${LINE_STRONG}`,
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: BG_2,
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} style={inputStyle} />
        <textarea
          value={a}
          onChange={(e) => setA(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancelEdit} style={btn("ghost")} disabled={busy}>
            Cancelar
          </button>
          <button
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              await onSave({ question: q.trim(), answer: a.trim() });
              setBusy(false);
            }}
            style={btn("primary")}
            disabled={busy}
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        border: `1px solid ${LINE}`,
        borderRadius: 8,
        background: "rgba(255,235,205,0.015)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: TEXT_0, fontWeight: 500, marginBottom: 4 }}>
            {faq.question}
          </div>
          <div style={{ fontSize: 12.5, color: TEXT_1, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {faq.answer}
          </div>
          {faq.source === "ai_generated" && (
            <div style={{ marginTop: 6 }}>
              <span style={chip("#1e2b3a", "#8cb4e8", true)}>gerada por IA</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onStartEdit} style={iconBtn} title="Editar">
            ✎
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await onDelete();
              setBusy(false);
            }}
            style={{ ...iconBtn, color: "#e08a8a" }}
            title="Remover"
            disabled={busy}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  background: BG_0,
  border: `1px solid ${LINE}`,
  borderRadius: 6,
  padding: "8px 10px",
  color: TEXT_0,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
};

function ReindexButton({ onReindex }: { onReindex: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        await onReindex();
        setBusy(false);
      }}
      style={{
        background: "transparent",
        border: "1px solid rgba(245,185,122,0.25)",
        color: COPPER_200,
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 11,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.6 : 1,
        fontFamily: "inherit",
      }}
      title="Reconstrói os chunks e embeddings desse empreendimento do zero. Útil se a Bia não achou algo que deveria."
      disabled={busy}
    >
      {busy ? "Reindexando…" : "⟳ Reindexar"}
    </button>
  );
}

const iconBtn: CSSProperties = {
  background: "transparent",
  border: `1px solid ${LINE}`,
  color: TEXT_2,
  borderRadius: 6,
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 14,
  fontFamily: "inherit",
};

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 20,
          color: TEXT_0,
          fontWeight: 400,
          letterSpacing: "-0.02em",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10.5,
          color: TEXT_3,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </span>
    </div>
  );
}
