"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  computeGaps,
  type Empreendimento,
  type Faq,
  type Foto,
  type FotoCategoria,
  type Gap,
  type Midia,
  type Tipologia,
} from "@/lib/empreendimentos-shared";

/**
 * Dashboard split-view de empreendimentos (modo leitura).
 *
 * Sidebar com busca + lista à esquerda; detalhe rico à direita (cover,
 * visão geral, tipologias com planta, diferenciais, base de IA, materiais,
 * FAQs). Edição de campos/criação mora em /admin/empreendimentos/[id] e
 * /admin/empreendimentos/new.
 */

const fmtBRL = (n?: number | null) =>
  typeof n === "number"
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    : "sob consulta";

const fmtDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
};

function statusLabel(s: Empreendimento["status"]): string {
  switch (s) {
    case "lancamento":
      return "Lançamento";
    case "em_obras":
      return "Em obras";
    case "pronto_para_morar":
      return "Pronto";
    default:
      return "—";
  }
}

function statusClass(s: Empreendimento["status"]): string {
  return s ? `status-${s}` : "status-none";
}

/** Gradient determinístico por hash — cores pastel pra combinar com light theme. */
function coverGradient(nome: string): CSSProperties {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) | 0;
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 40) % 360;
  return {
    "--_g1": `hsl(${hue1} 35% 68%)`,
    "--_g2": `hsl(${hue2} 40% 52%)`,
  } as CSSProperties;
}

export function EmpreendimentosDashboard({
  initial,
  canEdit,
  canCreate,
}: {
  initial: Empreendimento[];
  canEdit: boolean;
  canCreate: boolean;
}) {
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
  const bookingInputRef = useRef<HTMLInputElement>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoCategoriaUpload, setPhotoCategoriaUpload] = useState<FotoCategoria>("fachada");

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

  const docCount = useMemo(
    () => items.reduce((acc, e) => acc + (e.midias?.length ?? 0), 0),
    [items],
  );

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
    if (
      !confirm(
        `Excluir "${nome}"?\n\nIsso remove o empreendimento, FAQs, chunks do RAG e arquivos do storage. Leads que referenciam este empreendimento são preservados (só perdem o link).`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : "Falha ao excluir");
      setItems((arr) => {
        const next = arr.filter((e) => e.id !== empId);
        if (selectedId === empId) setSelectedId(next[0]?.id ?? null);
        return next;
      });
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
    if (
      !confirm(
        `Remover "${midia.name}"?\n\nO arquivo é apagado do storage. O conhecimento já extraído dele continua disponível pra Bia (edite o empreendimento pra limpar também se precisar).`,
      )
    ) {
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

  async function handleReplaceBooking(file: File | null | undefined) {
    if (!file || !selected) return;
    if (file.type !== "application/pdf") {
      alert("Envie um PDF.");
      return;
    }
    setBookingBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/empreendimentos/${selected.id}/booking`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha no upload");
      }
      setItems((arr) => arr.map((e) => (e.id === selected.id ? (json.data as Empreendimento) : e)));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBookingBusy(false);
      if (bookingInputRef.current) bookingInputRef.current.value = "";
    }
  }

  async function handleDeleteBooking(empId: string) {
    if (!confirm("Remover o booking digital deste empreendimento?")) return;
    setBookingBusy(true);
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/booking`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao remover");
      }
      setItems((arr) => arr.map((e) => (e.id === empId ? (json.data as Empreendimento) : e)));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBookingBusy(false);
    }
  }

  async function handleAddPhotos(files: FileList | null, categoria: FotoCategoria) {
    if (!files || files.length === 0 || !selected) return;
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch(
        `/api/admin/empreendimentos/${selected.id}/fotos?categoria=${categoria}`,
        { method: "POST", body: fd },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha no upload");
      }
      setItems((arr) => arr.map((e) => (e.id === selected.id ? (json.data as Empreendimento) : e)));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function handleUpdatePhoto(empId: string, fotoId: string, patch: Partial<Foto>) {
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/fotos`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: fotoId, ...patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao atualizar");
      }
      setItems((arr) => arr.map((e) => (e.id === empId ? (json.data as Empreendimento) : e)));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeletePhoto(empId: string, fotoId: string) {
    if (!confirm("Remover esta foto?")) return;
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empId}/fotos/${fotoId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao remover");
      }
      setItems((arr) => arr.map((e) => (e.id === empId ? (json.data as Empreendimento) : e)));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="emp-dash">
      {/* ── Sidebar ───────────────────────────────────── */}
      <aside className="emp-side">
        <div className="emp-side-head">
          <h1 className="emp-side-title">Empreendimentos</h1>
          <div className="emp-side-sub">
            {items.length} ativo{items.length === 1 ? "" : "s"} · {docCount} doc
            {docCount === 1 ? "" : "s"} na base da Bia
          </div>
          <input
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="emp-side-search"
          />
        </div>

        <div className="emp-side-list">
          {filtered.length === 0 ? (
            <div className="emp-side-empty">
              {items.length === 0 ? "Nenhum empreendimento ainda." : "Nenhum resultado."}
            </div>
          ) : (
            filtered.map((e) => {
              const active = e.id === selected?.id;
              const tipoCount = Array.isArray(e.tipologias) ? e.tipologias.length : 0;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={`emp-side-item${active ? " active" : ""}`}
                >
                  <div className="emp-thumb emp-thumb-gradient" style={coverGradient(e.nome)} />
                  <div className="emp-side-body">
                    <div className="emp-side-name">{e.nome}</div>
                    <div className="emp-side-loc">
                      {[e.bairro, e.cidade].filter(Boolean).join(", ") || "sem localização"}
                    </div>
                    <div className="emp-side-meta">
                      <span className={`emp-chip ${statusClass(e.status)}`}>
                        {statusLabel(e.status)}
                      </span>
                      <span className="emp-side-count">
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
      <main className="emp-main">
        {selected ? (
          <DetailView
            emp={selected}
            canEdit={canEdit}
            canCreate={canCreate}
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
            onUploadBookingClick={() => bookingInputRef.current?.click()}
            onDeleteBooking={() => handleDeleteBooking(selected.id)}
            bookingBusy={bookingBusy}
            onUploadPhotosClick={(cat) => {
              setPhotoCategoriaUpload(cat);
              photoInputRef.current?.click();
            }}
            onUpdatePhoto={(fotoId, patch) => handleUpdatePhoto(selected.id, fotoId, patch)}
            onDeletePhoto={(fotoId) => handleDeletePhoto(selected.id, fotoId)}
            photoBusy={photoBusy}
          />
        ) : (
          <div className="emp-empty-main">
            {canCreate
              ? "Cadastre o primeiro empreendimento para começar."
              : "Nenhum empreendimento cadastrado. Peça pro admin."}
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
        <input
          ref={bookingInputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => handleReplaceBooking(e.target.files?.[0])}
          style={{ display: "none" }}
        />
        <input
          ref={photoInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => handleAddPhotos(e.target.files, photoCategoriaUpload)}
          style={{ display: "none" }}
        />
      </main>
    </div>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────

function DetailView({
  emp,
  canEdit,
  canCreate,
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
  onUploadBookingClick,
  onDeleteBooking,
  bookingBusy,
  onUploadPhotosClick,
  onUpdatePhoto,
  onDeletePhoto,
  photoBusy,
}: {
  emp: Empreendimento;
  canEdit: boolean;
  canCreate: boolean;
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
  onUploadBookingClick: () => void;
  onDeleteBooking: () => Promise<void>;
  bookingBusy: boolean;
  onUploadPhotosClick: (categoria: FotoCategoria) => void;
  onUpdatePhoto: (fotoId: string, patch: Partial<Foto>) => Promise<void>;
  onDeletePhoto: (fotoId: string) => Promise<void>;
  photoBusy: boolean;
}) {
  const tipologias: Tipologia[] = Array.isArray(emp.tipologias) ? emp.tipologias : [];
  const diferenciais: string[] = Array.isArray(emp.diferenciais) ? emp.diferenciais : [];
  const lazer: string[] = Array.isArray(emp.lazer) ? emp.lazer : [];
  const midias: Midia[] = Array.isArray(emp.midias) ? emp.midias : [];
  const rawCount = Array.isArray(emp.raw_knowledge) ? emp.raw_knowledge.length : 0;
  const gaps = useMemo(() => computeGaps(emp, faqs.length), [emp, faqs.length]);

  const precos = tipologias
    .map((t) => t.preco)
    .filter((p): p is number => typeof p === "number" && p > 0);
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
      <div className="emp-cover emp-cover-gradient" style={coverGradient(emp.nome)}>
        <div className="emp-cover-fade" />
        <div className="emp-cover-content">
          <div>
            <span className={`emp-chip ${statusClass(emp.status)}`}>{statusLabel(emp.status)}</span>
            <h2 className="emp-cover-title">{emp.nome}</h2>
            <div className="emp-cover-meta">
              <span>📍 {[emp.bairro, emp.cidade].filter(Boolean).join(", ") || "sem localização"}</span>
              {emp.construtora ? (
                <>
                  <span className="sep">·</span>
                  <span>{emp.construtora}</span>
                </>
              ) : null}
              {emp.entrega ? (
                <>
                  <span className="sep">·</span>
                  <span>Entrega {fmtDate(emp.entrega)}</span>
                </>
              ) : null}
            </div>
          </div>
          {canEdit ? (
            <div className="emp-cover-actions">
              <button
                onClick={onUploadClick}
                disabled={uploading}
                className="emp-btn ai"
              >
                {uploading ? "Extraindo…" : "✨ Adicionar documentos"}
              </button>
              <Link href={`/admin/empreendimentos/${emp.id}`} className="emp-btn">
                Editar
              </Link>
              <button onClick={onDeleteEmp} className="emp-btn danger" title="Excluir empreendimento">
                Excluir
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Banner de enriquecimento */}
      {lastChange ? (
        <div className="emp-banner">
          ✓ {lastChange.added} documento{lastChange.added === 1 ? "" : "s"} indexado
          {lastChange.added === 1 ? "" : "s"}.{" "}
          {lastChange.changed.length === 0
            ? "Nenhum campo novo extraído (o conteúdo bruto está disponível no RAG)."
            : `Campos enriquecidos: ${lastChange.changed.join(", ")}.`}
        </div>
      ) : null}

      {/* Grid de cards */}
      <div className="emp-grid">
        {/* Visão geral */}
        <div className="emp-box">
          <span className="emp-caps">Visão geral</span>
          <div className="emp-kv">
            <div className="emp-kv-row">
              <span className="k">Tipologias</span>
              <span className="v">{tipologias.length || "—"}</span>
            </div>
            <div className="emp-kv-row hi">
              <span className="k">Faixa de preço</span>
              <span className="v">{faixaPreco}</span>
            </div>
            <div className="emp-kv-row">
              <span className="k">Entrega</span>
              <span className="v">{fmtDate(emp.entrega)}</span>
            </div>
            <div className="emp-kv-row">
              <span className="k">Incorporadora</span>
              <span className="v">{emp.construtora ?? "—"}</span>
            </div>
            <div className="emp-kv-row">
              <span className="k">Endereço</span>
              <span className="v truncate" title={emp.endereco ?? ""}>
                {emp.endereco ?? "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Tipologias */}
        <div className="emp-box">
          <span className="emp-caps">Tipologias</span>
          {tipologias.length === 0 ? (
            <div className="emp-faq-empty">Sem tipologias cadastradas.</div>
          ) : (
            <div className="emp-typs">
              {tipologias.map((t, i) => (
                <div key={i} className="emp-typ">
                  <div className="emp-typ-svg">
                    <svg viewBox="0 0 100 80" width="100%" height="100%">
                      <rect x="2" y="2" width="96" height="76" fill="none" strokeWidth={1} opacity="0.45" />
                      <rect x="8" y="8" width="40" height="30" fill="none" strokeWidth={1} opacity="0.6" />
                      <rect x="52" y="8" width="40" height="30" fill="none" strokeWidth={1} opacity="0.6" />
                      <rect x="8" y="42" width="84" height="30" fill="none" strokeWidth={1} opacity="0.4" />
                      <line x1="50" y1="8" x2="50" y2="38" strokeWidth={1} opacity="0.4" />
                    </svg>
                  </div>
                  <div className="emp-typ-name">
                    {t.quartos != null
                      ? `${t.quartos} ${t.quartos === 1 ? "quarto" : "quartos"}`
                      : "Studio"}
                  </div>
                  <div className="emp-typ-meta">
                    {t.area ? `${t.area}m²` : "—"}
                    {t.preco ? ` · ${fmtBRL(t.preco)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Diferenciais */}
        <div className="emp-box emp-box-wide">
          <span className="emp-caps">Diferenciais</span>
          {diferenciais.length === 0 && lazer.length === 0 ? (
            <div className="emp-faq-empty">Sem diferenciais cadastrados.</div>
          ) : (
            <div className="emp-dif-grid">
              {[...diferenciais, ...lazer].map((d, i) => (
                <div key={i} className="emp-dif-item">
                  <span className="emp-dot" />
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Base da IA */}
        <div className="emp-box-ai">
          <div className="emp-ai-head">
            <span className="emp-ai-label">
              <span className="emp-ai-dot" />
              Base de conhecimento da IA
            </span>
            <div className="emp-ai-actions">
              <span className={`emp-chip ${midias.length > 0 ? "ok-soft" : "status-none"}`}>
                {midias.length > 0 ? "sincronizada" : "vazia"}
              </span>
              {canEdit ? <ReindexButton onReindex={onReindex} /> : null}
            </div>
          </div>
          <div className="emp-ai-desc">
            A Bia consulta{" "}
            <strong>
              {midias.length} documento{midias.length === 1 ? "" : "s"}
            </strong>
            ,{" "}
            <strong>
              {rawCount} bloco{rawCount === 1 ? "" : "s"} bruto{rawCount === 1 ? "" : "s"}
            </strong>{" "}
            e{" "}
            <strong>
              {faqs.length} FAQ{faqs.length === 1 ? "" : "s"}
            </strong>{" "}
            pra responder sobre este empreendimento. Conteúdo estruturado extraído
            automaticamente quando você adiciona documentos.
          </div>
          <div className="emp-ai-stats">
            <Stat value={midias.length} label="documentos" />
            <Stat value={rawCount} label="blocos brutos" />
            <Stat
              value={tipologias.length + diferenciais.length + lazer.length}
              label="dados estruturados"
            />
            <Stat value={faqs.length} label={`FAQ${faqs.length === 1 ? "" : "s"}`} />
          </div>

          {gaps.length > 0 ? (
            <div className="emp-ai-gaps">
              <div className="emp-ai-gaps-title">Lacunas ({gaps.length})</div>
              <div className="emp-gaps">
                {gaps.map((g) => (
                  <GapBadge key={g.field} gap={g} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Descrição */}
        {emp.descricao ? (
          <div className="emp-box emp-box-wide">
            <span className="emp-caps">Descrição</span>
            <div className="emp-desc">{emp.descricao}</div>
          </div>
        ) : null}

        {/* Materiais */}
        <div className="emp-box emp-box-wide">
          <span className="emp-caps">Materiais ({midias.length})</span>
          {midias.length === 0 ? (
            <div className="emp-faq-empty">
              Nenhum material anexado.
              {canEdit ? (
                <>
                  {" "}
                  Use <strong>Adicionar documentos</strong> no topo.
                </>
              ) : null}
            </div>
          ) : (
            <div className="emp-midias">
              {midias.map((m, i) => (
                <div key={`${m.path}-${i}`} className="emp-midia">
                  <a
                    href={`/api/admin/empreendimentos/${emp.id}/docs/${encodeURIComponent(m.path)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="emp-midia-icon">{docIcon(m.type)}</div>
                    <div className="emp-midia-name" title={m.name}>
                      {m.name}
                      <div className="emp-midia-size">{(m.size / 1024).toFixed(0)} KB</div>
                    </div>
                  </a>
                  {canEdit ? (
                    <button
                      onClick={() => onDeleteMidia(m)}
                      className="emp-icon-btn danger"
                      title="Remover arquivo"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Booking digital — PDF de venda, enviado pela Bia. NÃO entra no RAG. */}
        <div className="emp-box emp-box-wide">
          <div className="emp-booking-head">
            <div>
              <span className="emp-caps">Booking digital</span>
              <div className="emp-booking-sub">
                PDF que a Bia envia direto pro lead. Não entra na base de conhecimento.
              </div>
            </div>
            {canEdit ? (
              <div className="emp-booking-actions">
                <button
                  onClick={onUploadBookingClick}
                  disabled={bookingBusy}
                  className="emp-btn"
                >
                  {bookingBusy
                    ? "Enviando…"
                    : emp.booking_digital_path
                      ? "Substituir"
                      : "Adicionar PDF"}
                </button>
                {emp.booking_digital_path ? (
                  <button
                    onClick={onDeleteBooking}
                    disabled={bookingBusy}
                    className="emp-btn danger"
                  >
                    Remover
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {emp.booking_digital_path ? (
            <a
              href={`/api/admin/empreendimentos/${emp.id}/booking`}
              target="_blank"
              rel="noreferrer"
              className="emp-booking-link"
            >
              <span className="emp-midia-icon">{docIcon("pdf")}</span>
              <span className="emp-booking-name">
                {emp.booking_digital_path.split("/").pop() ?? "booking.pdf"}
              </span>
              <span className="emp-booking-preview">abrir ↗</span>
            </a>
          ) : (
            <div className="emp-faq-empty">
              Nenhum booking cadastrado.
              {canEdit ? " Clique em Adicionar PDF." : ""}
            </div>
          )}
        </div>

        {/* Fotos — galeria pra Bia enviar. NÃO entra no RAG. */}
        <div className="emp-box emp-box-wide">
          <PhotosPanel
            emp={emp}
            canEdit={canEdit}
            photoBusy={photoBusy}
            onUploadPhotosClick={onUploadPhotosClick}
            onUpdatePhoto={onUpdatePhoto}
            onDeletePhoto={onDeletePhoto}
          />
        </div>

        {/* FAQ */}
        <div className="emp-box emp-box-wide">
          <div className="emp-faq-head">
            <div className="emp-faq-head-title">
              <span className="emp-caps-inline">FAQ ({faqs.length})</span>
              <span className="emp-faq-head-sub">Perguntas frequentes que a Bia usa no RAG.</span>
            </div>
          </div>
          <FaqSection
            faqs={faqs}
            loading={faqLoading}
            canEdit={canEdit}
            onAdd={onAddFaq}
            onUpdate={onUpdateFaq}
            onDelete={onDeleteFaq}
            onSuggest={onSuggestFaqs}
            onBulkApprove={onBulkApproveFaqs}
          />
        </div>
      </div>

      {/* Reserved: canCreate indica permissão pra criar novo (usado no Topbar do server). */}
      {canCreate ? null : null}
    </>
  );
}

// ─── Fotos ────────────────────────────────────────────────────────────────

const CATEGORIAS: { value: FotoCategoria; label: string }[] = [
  { value: "fachada", label: "Fachada" },
  { value: "lazer", label: "Lazer" },
  { value: "decorado", label: "Decorado" },
  { value: "planta", label: "Planta" },
  { value: "vista", label: "Vista" },
  { value: "outros", label: "Outros" },
];

function PhotosPanel({
  emp,
  canEdit,
  photoBusy,
  onUploadPhotosClick,
  onUpdatePhoto,
  onDeletePhoto,
}: {
  emp: Empreendimento;
  canEdit: boolean;
  photoBusy: boolean;
  onUploadPhotosClick: (categoria: FotoCategoria) => void;
  onUpdatePhoto: (fotoId: string, patch: Partial<Foto>) => Promise<void>;
  onDeletePhoto: (fotoId: string) => Promise<void>;
}) {
  const fotos: Foto[] = Array.isArray(emp.fotos) ? emp.fotos : [];
  const [filter, setFilter] = useState<FotoCategoria | "todas">("todas");
  const [uploadCat, setUploadCat] = useState<FotoCategoria>("fachada");

  const counts = useMemo(() => {
    const m = new Map<FotoCategoria, number>();
    for (const f of fotos) m.set(f.categoria, (m.get(f.categoria) ?? 0) + 1);
    return m;
  }, [fotos]);

  const visible = useMemo(() => {
    const list = filter === "todas" ? fotos : fotos.filter((f) => f.categoria === filter);
    return [...list].sort((a, b) => a.ordem - b.ordem);
  }, [fotos, filter]);

  return (
    <>
      <div className="emp-photos-head">
        <div>
          <span className="emp-caps">Fotos ({fotos.length})</span>
          <div className="emp-booking-sub">
            Material visual pro lead. Não entra na base de conhecimento.
          </div>
        </div>
        {canEdit ? (
          <div className="emp-photos-upload">
            <select
              value={uploadCat}
              onChange={(e) => setUploadCat(e.target.value as FotoCategoria)}
              className="emp-select"
              disabled={photoBusy}
            >
              {CATEGORIAS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => onUploadPhotosClick(uploadCat)}
              disabled={photoBusy}
              className="emp-btn"
            >
              {photoBusy ? "Enviando…" : "Adicionar fotos"}
            </button>
          </div>
        ) : null}
      </div>

      {fotos.length > 0 ? (
        <div className="emp-photos-filter">
          <button
            onClick={() => setFilter("todas")}
            className={`emp-chip filter${filter === "todas" ? " active" : ""}`}
          >
            Todas ({fotos.length})
          </button>
          {CATEGORIAS.map((c) => {
            const n = counts.get(c.value) ?? 0;
            if (n === 0) return null;
            return (
              <button
                key={c.value}
                onClick={() => setFilter(c.value)}
                className={`emp-chip filter${filter === c.value ? " active" : ""}`}
              >
                {c.label} ({n})
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="emp-faq-empty">
          {fotos.length === 0
            ? canEdit
              ? "Nenhuma foto ainda. Escolha a categoria e clique em Adicionar fotos."
              : "Nenhuma foto cadastrada."
            : "Nenhuma foto nessa categoria."}
        </div>
      ) : (
        <div className="emp-photos-grid">
          {visible.map((f) => (
            <PhotoCard
              key={f.id}
              emp={emp}
              foto={f}
              canEdit={canEdit}
              onUpdate={(patch) => onUpdatePhoto(f.id, patch)}
              onDelete={() => onDeletePhoto(f.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PhotoCard({
  emp,
  foto,
  canEdit,
  onUpdate,
  onDelete,
}: {
  emp: Empreendimento;
  foto: Foto;
  canEdit: boolean;
  onUpdate: (patch: Partial<Foto>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [legenda, setLegenda] = useState(foto.legenda ?? "");
  const src = `/api/admin/empreendimentos/${emp.id}/docs/${encodeURIComponent(foto.path)}`;

  async function saveLegenda() {
    const trimmed = legenda.trim();
    if ((trimmed || null) === (foto.legenda ?? null)) {
      setEditing(false);
      return;
    }
    await onUpdate({ legenda: trimmed || null });
    setEditing(false);
  }

  return (
    <div className="emp-photo-card">
      <a href={src} target="_blank" rel="noreferrer" className="emp-photo-link">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={foto.legenda ?? foto.name} className="emp-photo-img" />
      </a>
      <div className="emp-photo-meta">
        {canEdit ? (
          <select
            value={foto.categoria}
            onChange={(e) => onUpdate({ categoria: e.target.value as FotoCategoria })}
            className="emp-photo-cat"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="emp-photo-cat-static">
            {CATEGORIAS.find((c) => c.value === foto.categoria)?.label ?? foto.categoria}
          </span>
        )}
        {canEdit ? (
          <button className="emp-icon-btn danger" onClick={onDelete} title="Remover foto">
            ×
          </button>
        ) : null}
      </div>
      {editing && canEdit ? (
        <div className="emp-photo-caption-edit">
          <input
            autoFocus
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            onBlur={saveLegenda}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveLegenda();
              if (e.key === "Escape") {
                setLegenda(foto.legenda ?? "");
                setEditing(false);
              }
            }}
            placeholder="Legenda…"
            className="emp-input"
          />
        </div>
      ) : (
        <button
          type="button"
          className="emp-photo-caption"
          onClick={() => canEdit && setEditing(true)}
          title={canEdit ? "Editar legenda" : undefined}
          disabled={!canEdit}
        >
          {foto.legenda || (canEdit ? "+ legenda" : "")}
        </button>
      )}
    </div>
  );
}

// ─── Gaps badge ───────────────────────────────────────────────────────────

function GapBadge({ gap }: { gap: Gap }) {
  return (
    <span className={`emp-gap sev-${gap.severity}`} title={gap.hint ?? gap.label}>
      <span className="dot" />
      {gap.label}
    </span>
  );
}

// ─── FAQ section ──────────────────────────────────────────────────────────

type Proposal = { question: string; answer: string; selected: boolean };

function FaqSection({
  faqs,
  loading,
  canEdit,
  onAdd,
  onUpdate,
  onDelete,
  onSuggest,
  onBulkApprove,
}: {
  faqs: Faq[];
  loading: boolean;
  canEdit: boolean;
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
        alert(
          "A IA não encontrou novas perguntas relevantes — o cadastro já está bem coberto ou a base de conhecimento é pobre. Suba mais docs e tente de novo.",
        );
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
        <div className="emp-faq-empty">Carregando FAQs…</div>
      ) : faqs.length === 0 && !adding ? (
        <div className="emp-faq-empty">
          Nenhuma FAQ ainda.
          {canEdit ? " Adicione perguntas que clientes repetem." : ""}
        </div>
      ) : (
        <div className="emp-faq-list">
          {faqs.map((f) => (
            <FaqItem
              key={f.id}
              faq={f}
              canEdit={canEdit}
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

      {canEdit && adding ? (
        <div className="emp-faq-add">
          <input
            autoFocus
            placeholder="Pergunta (ex: tem pet place?)"
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            className="emp-input"
          />
          <textarea
            placeholder="Resposta"
            value={newA}
            onChange={(e) => setNewA(e.target.value)}
            rows={3}
            className="emp-textarea"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={() => {
                setAdding(false);
                setNewQ("");
                setNewA("");
              }}
              className="emp-btn"
              disabled={busy}
            >
              Cancelar
            </button>
            <button onClick={submitNew} className="emp-btn primary" disabled={busy}>
              {busy ? "Salvando…" : "Adicionar"}
            </button>
          </div>
        </div>
      ) : canEdit ? (
        <div className="emp-faq-actions">
          <button onClick={() => setAdding(true)} className="emp-btn">
            + Nova FAQ
          </button>
          <button
            onClick={handleSuggest}
            className="emp-btn ai"
            disabled={suggesting}
            title="A IA varre o conteúdo cadastrado e propõe FAQs novas pra você revisar."
          >
            {suggesting ? "Analisando conteúdo…" : "✨ Sugerir com IA"}
          </button>
        </div>
      ) : null}

      {proposals ? (
        <FaqSuggestPanel
          proposals={proposals}
          busy={approving}
          onChange={setProposals}
          onApprove={approveSelected}
          onDiscard={() => setProposals(null)}
        />
      ) : null}
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
    <div className="emp-sug">
      <div className="emp-sug-head">
        <div>
          <div className="emp-sug-title">
            <span className="emp-ai-dot" />
            {proposals.length} sugestões da IA
          </div>
          <div className="emp-sug-sub">edite antes de aprovar se quiser</div>
        </div>
        <button
          onClick={() => toggleAll(selectedCount !== proposals.length)}
          className="emp-btn sm"
          disabled={busy}
        >
          {selectedCount === proposals.length ? "Desmarcar todas" : "Selecionar todas"}
        </button>
      </div>

      <div className="emp-sug-list">
        {proposals.map((p, i) => (
          <div key={i} className={`emp-sug-item ${p.selected ? "on" : "off"}`}>
            <input
              type="checkbox"
              checked={p.selected}
              onChange={(e) => update(i, { selected: e.target.checked })}
              disabled={busy}
              className="emp-sug-check"
            />
            <div className="emp-sug-item-body">
              <input
                value={p.question}
                onChange={(e) => update(i, { question: e.target.value })}
                disabled={busy || !p.selected}
                className="emp-input bold"
                placeholder="Pergunta"
              />
              <textarea
                value={p.answer}
                onChange={(e) => update(i, { answer: e.target.value })}
                disabled={busy || !p.selected}
                rows={2}
                className="emp-textarea"
                style={{ minHeight: 48, fontSize: 12.5 }}
                placeholder="Resposta"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="emp-sug-footer">
        <button onClick={onDiscard} className="emp-btn" disabled={busy}>
          Descartar tudo
        </button>
        <button
          onClick={onApprove}
          className="emp-btn primary"
          disabled={busy || selectedCount === 0}
        >
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
  canEdit,
  editing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  faq: Faq;
  canEdit: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<Faq>) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [q, setQ] = useState(faq.question);
  const [a, setA] = useState(faq.answer);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) {
      setQ(faq.question);
      setA(faq.answer);
    }
  }, [faq.question, faq.answer, editing]);

  if (editing) {
    return (
      <div className="emp-faq-item editing">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="emp-input" />
        <textarea
          value={a}
          onChange={(e) => setA(e.target.value)}
          rows={3}
          className="emp-textarea"
          style={{ marginTop: 8 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button onClick={onCancelEdit} className="emp-btn" disabled={busy}>
            Cancelar
          </button>
          <button
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              await onSave({ question: q.trim(), answer: a.trim() });
              setBusy(false);
            }}
            className="emp-btn primary"
            disabled={busy}
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="emp-faq-item">
      <div className="emp-faq-item-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="emp-faq-q">{faq.question}</div>
          <div className="emp-faq-a">{faq.answer}</div>
          {faq.source === "ai_generated" ? (
            <div className="emp-faq-source">
              <span className="emp-chip ai-source">gerada por IA</span>
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <div className="emp-faq-item-actions">
            <button onClick={onStartEdit} className="emp-icon-btn" title="Editar">
              ✎
            </button>
            <button
              onClick={async () => {
                setBusy(true);
                await onDelete();
                setBusy(false);
              }}
              className="emp-icon-btn danger"
              title="Remover"
              disabled={busy}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
      className="emp-btn-reindex"
      title="Reconstrói os chunks e embeddings desse empreendimento do zero. Útil se a Bia não achou algo que deveria."
      disabled={busy}
    >
      {busy ? "Reindexando…" : "⟳ Reindexar"}
    </button>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="emp-stat">
      <span className="emp-stat-n">{value}</span>
      <span className="emp-stat-l">{label}</span>
    </div>
  );
}

function docIcon(type: string): string {
  switch (type) {
    case "pdf":
      return "📄";
    case "sheet":
      return "📊";
    case "image":
      return "🖼";
    default:
      return "📎";
  }
}
