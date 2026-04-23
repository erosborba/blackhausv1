"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Empreendimento, Midia, Tipologia } from "@/lib/empreendimentos-shared";
import { TabelaPrecosSection } from "./tabela-precos-section";

/**
 * Detail/edit de um empreendimento existente.
 *
 * Dois fluxos principais convivem aqui:
 *
 *  1. Edição manual dos campos (PATCH). Campos seguem o mesmo shape da
 *     criação; "Salvar" só aparece quando há `dirty`.
 *
 *  2. "Adicionar documentos" (POST /docs). O corretor sobe PDFs/XLSX/imagens
 *     novos, a IA extrai, o servidor faz merge (sem sobrescrever edições)
 *     e devolve o empreendimento atualizado + lista de campos que mudaram.
 *     A UI mostra a diff em um banner pra ele entender o que foi enriquecido.
 */

type FormState = {
  nome: string;
  construtora: string;
  status: "" | Empreendimento["status"];
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  preco_inicial: string;
  entrega: string;
  descricao: string;
  tipologias: Tipologia[];
  diferenciais: string; // textarea, uma por linha
  lazer: string;
};

function toFormState(e: Empreendimento): FormState {
  return {
    nome: e.nome ?? "",
    construtora: e.construtora ?? "",
    status: (e.status ?? "") as FormState["status"],
    endereco: e.endereco ?? "",
    bairro: e.bairro ?? "",
    cidade: e.cidade ?? "",
    estado: e.estado ?? "",
    preco_inicial: e.preco_inicial != null ? String(e.preco_inicial) : "",
    entrega: e.entrega ?? "",
    descricao: e.descricao ?? "",
    tipologias: Array.isArray(e.tipologias) ? e.tipologias : [],
    diferenciais: Array.isArray(e.diferenciais) ? e.diferenciais.join("\n") : "",
    lazer: Array.isArray(e.lazer) ? e.lazer.join("\n") : "",
  };
}

// ─── Estilos ─────────────────────────────────────────────────────────────────
const container: CSSProperties = { maxWidth: 960, margin: "0 auto", padding: "32px 20px" };
const card: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  padding: 24,
  marginBottom: 20,
};
const label: CSSProperties = {
  display: "block",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8f8f9a",
  marginBottom: 6,
};
const input: CSSProperties = {
  width: "100%",
  background: "#0b0b0d",
  border: "1px solid #2a2a32",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#e7e7ea",
  fontSize: 14,
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const button = (variant: "primary" | "ghost" | "ai" = "ghost"): CSSProperties => ({
  background: variant === "primary" ? "#3b82f6" : variant === "ai" ? "#3a2a4d" : "#2a2a32",
  color: variant === "ai" ? "#c9a8ff" : variant === "primary" ? "#fff" : "#e7e7ea",
  border: variant === "ai" ? "1px solid #4a3a5e" : "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 500,
});
const chip = (bg: string, fg: string): CSSProperties => ({
  background: bg,
  color: fg,
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  display: "inline-block",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 500,
});

const FIELD_LABELS: Record<string, string> = {
  nome: "Nome",
  construtora: "Construtora",
  status: "Status",
  endereco: "Endereço",
  bairro: "Bairro",
  cidade: "Cidade",
  estado: "UF",
  preco_inicial: "Preço inicial",
  entrega: "Entrega",
  descricao: "Descrição",
  tipologias: "Tipologias",
  diferenciais: "Diferenciais",
  lazer: "Lazer",
};

export function DetailClient({ initial }: { initial: Empreendimento }) {
  const router = useRouter();
  const [emp, setEmp] = useState<Empreendimento>(initial);
  const [form, setForm] = useState<FormState>(toFormState(initial));
  const [savedForm, setSavedForm] = useState<FormState>(toFormState(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload de docs novos
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lastChange, setLastChange] = useState<{ changed: string[]; added: number } | null>(null);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(savedForm), [form, savedForm]);

  function updateTipologia(i: number, patch: Partial<Tipologia>) {
    setForm((f) => {
      const copy = [...f.tipologias];
      copy[i] = { ...copy[i], ...patch };
      return { ...f, tipologias: copy };
    });
  }
  function addTipologia() {
    setForm((f) => ({ ...f, tipologias: [...f.tipologias, {}] }));
  }
  function removeTipologia(i: number) {
    setForm((f) => ({ ...f, tipologias: f.tipologias.filter((_, idx) => idx !== i) }));
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      setError("Nome é obrigatório");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        nome: form.nome,
        construtora: form.construtora || null,
        status: form.status || null,
        endereco: form.endereco || null,
        bairro: form.bairro || null,
        cidade: form.cidade || null,
        estado: form.estado || null,
        preco_inicial: form.preco_inicial ? Number(form.preco_inicial) : null,
        entrega: form.entrega || null,
        descricao: form.descricao || null,
        tipologias: form.tipologias,
        diferenciais: form.diferenciais.split("\n").map((s) => s.trim()).filter(Boolean),
        lazer: form.lazer.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch(`/api/admin/empreendimentos/${emp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao salvar");
      }
      setEmp(json.data);
      setSavedForm(toFormState(json.data));
      setForm(toFormState(json.data));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDocs(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    setLastChange(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch(`/api/admin/empreendimentos/${emp.id}/docs`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao enviar documentos");
      }
      // Atualiza estado com o empreendimento merged do servidor.
      setEmp(json.data);
      const freshForm = toFormState(json.data);
      setForm(freshForm);
      setSavedForm(freshForm);
      setLastChange({
        changed: Array.isArray(json.changed) ? json.changed : [],
        added: Array.isArray(json.uploaded) ? json.uploaded.length : 0,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const midias: Midia[] = Array.isArray(emp.midias) ? (emp.midias as Midia[]) : [];

  return (
    <main style={container}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/admin/empreendimentos"
          style={{ color: "#8f8f9a", textDecoration: "none", fontSize: 13 }}
        >
          ← Empreendimentos
        </Link>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 24 }}>{emp.nome}</h1>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,image/*"
              onChange={(e) => handleAddDocs(e.target.files)}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{ ...button("ai"), opacity: uploading ? 0.5 : 1 }}
            >
              {uploading ? "Extraindo..." : "✨ Adicionar documentos"}
            </button>
          </div>
        </div>
        <div style={{ color: "#8f8f9a", fontSize: 13, marginTop: 4 }}>
          {[emp.bairro, emp.cidade].filter(Boolean).join(", ") || "sem localização"} ·{" "}
          {midias.length} {midias.length === 1 ? "documento" : "documentos"} na base
        </div>
      </div>

      {/* Banner de diff depois de adicionar docs */}
      {lastChange && (
        <div
          style={{
            ...card,
            background: "#1a2a1e",
            borderColor: "#2b4a36",
            marginBottom: 20,
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: 14, color: "#6bd99b" }}>
            <strong>✓ {lastChange.added} documento{lastChange.added === 1 ? "" : "s"} indexado{lastChange.added === 1 ? "" : "s"}.</strong>{" "}
            {lastChange.changed.length === 0
              ? "Nenhum campo novo — a IA não encontrou dados estruturados adicionais (mas o conteúdo bruto está disponível)."
              : `Campos enriquecidos: ${lastChange.changed.map((k) => FIELD_LABELS[k] ?? k).join(", ")}.`}
          </div>
        </div>
      )}

      {/* Dados básicos */}
      <section style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Dados básicos</h2>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Nome*</label>
          <input
            style={input}
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={label}>Construtora</label>
            <input
              style={input}
              value={form.construtora}
              onChange={(e) => setForm({ ...form, construtora: e.target.value })}
            />
          </div>
          <div>
            <label style={label}>Status</label>
            <select
              style={input}
              value={form.status ?? ""}
              onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}
            >
              <option value="">—</option>
              <option value="lancamento">Lançamento</option>
              <option value="em_obras">Em obras</option>
              <option value="pronto_para_morar">Pronto para morar</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Endereço</label>
          <input
            style={input}
            value={form.endereco}
            onChange={(e) => setForm({ ...form, endereco: e.target.value })}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 80px",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <div>
            <label style={label}>Bairro</label>
            <input
              style={input}
              value={form.bairro}
              onChange={(e) => setForm({ ...form, bairro: e.target.value })}
            />
          </div>
          <div>
            <label style={label}>Cidade</label>
            <input
              style={input}
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            />
          </div>
          <div>
            <label style={label}>UF</label>
            <input
              style={input}
              maxLength={2}
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={label}>Preço inicial (R$)</label>
            <input
              style={input}
              type="number"
              value={form.preco_inicial}
              onChange={(e) => setForm({ ...form, preco_inicial: e.target.value })}
            />
          </div>
          <div>
            <label style={label}>Entrega</label>
            <input
              style={input}
              type="date"
              value={form.entrega ?? ""}
              onChange={(e) => setForm({ ...form, entrega: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label style={label}>Descrição</label>
          <textarea
            style={{ ...input, minHeight: 120, resize: "vertical" }}
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          />
        </div>
      </section>

      {/* Tipologias */}
      <section style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Tipologias</h2>
        {form.tipologias.length === 0 && (
          <div style={{ color: "#8f8f9a", fontSize: 13, marginBottom: 10 }}>
            Nenhuma tipologia cadastrada.
          </div>
        )}
        {form.tipologias.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr) 44px",
              gap: 10,
              marginBottom: 6,
              padding: "0 2px",
            }}
          >
            {["Quartos", "Suítes", "Vagas", "Área m²", "Preço R$", ""].map((h, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "#8f8f9a",
                  fontWeight: 500,
                }}
              >
                {h}
              </div>
            ))}
          </div>
        )}
        {form.tipologias.map((t, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr) 44px",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <input
              style={input}
              aria-label="Quartos"
              placeholder="Quartos"
              type="number"
              value={t.quartos ?? ""}
              onChange={(e) =>
                updateTipologia(i, { quartos: e.target.value ? Number(e.target.value) : undefined })
              }
            />
            <input
              style={input}
              aria-label="Suítes"
              placeholder="Suítes"
              type="number"
              value={t.suites ?? ""}
              onChange={(e) =>
                updateTipologia(i, { suites: e.target.value ? Number(e.target.value) : undefined })
              }
            />
            <input
              style={input}
              aria-label="Vagas"
              placeholder="Vagas"
              type="number"
              value={t.vagas ?? ""}
              onChange={(e) =>
                updateTipologia(i, { vagas: e.target.value ? Number(e.target.value) : undefined })
              }
            />
            <input
              style={input}
              aria-label="Área m²"
              placeholder="Área m²"
              type="number"
              value={t.area ?? ""}
              onChange={(e) =>
                updateTipologia(i, { area: e.target.value ? Number(e.target.value) : undefined })
              }
            />
            <input
              style={input}
              aria-label="Preço R$"
              placeholder="Preço R$"
              type="number"
              value={t.preco ?? ""}
              onChange={(e) =>
                updateTipologia(i, { preco: e.target.value ? Number(e.target.value) : undefined })
              }
            />
            <button
              onClick={() => removeTipologia(i)}
              aria-label="Remover tipologia"
              style={{ ...button(), padding: "0 12px" }}
            >
              ×
            </button>
          </div>
        ))}
        <button onClick={addTipologia} style={button()}>
          + Adicionar tipologia
        </button>
      </section>

      {/* Diferenciais & Lazer */}
      <section style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Diferenciais &amp; Lazer</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={label}>Diferenciais (um por linha)</label>
            <textarea
              style={{ ...input, minHeight: 140, resize: "vertical" }}
              value={form.diferenciais}
              onChange={(e) => setForm({ ...form, diferenciais: e.target.value })}
            />
          </div>
          <div>
            <label style={label}>Lazer (um por linha)</label>
            <textarea
              style={{ ...input, minHeight: 140, resize: "vertical" }}
              value={form.lazer}
              onChange={(e) => setForm({ ...form, lazer: e.target.value })}
            />
          </div>
        </div>
      </section>

      {/* Tabela de preços */}
      <TabelaPrecosSection empreendimentoId={emp.id} />

      {/* Materiais */}
      <section style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>
          Materiais <span style={{ color: "#8f8f9a", fontSize: 12, fontWeight: 400 }}>· {midias.length}</span>
        </h2>
        {midias.length === 0 ? (
          <div style={{ color: "#8f8f9a", fontSize: 13 }}>
            Nenhum documento anexado ainda. Use <strong>Adicionar documentos</strong> no topo.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
            {midias.map((m, i) => (
              <div
                key={`${m.path}-${i}`}
                style={{
                  background: "#0b0b0d",
                  border: "1px solid #2a2a32",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 20 }}>
                  {m.type === "pdf"
                    ? "📄"
                    : m.type === "sheet"
                      ? "📊"
                      : m.type === "image"
                        ? "🖼️"
                        : "📎"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#e7e7ea",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={m.name}
                  >
                    {m.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#8f8f9a" }}>
                    {(m.size / 1024).toFixed(0)} KB
                    {m.added_at ? ` · ${new Date(m.added_at).toLocaleDateString("pt-BR")}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ações */}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" }}>
        {dirty && (
          <span style={chip("#3a2e1e", "#d9a66b")}>alterações não salvas</span>
        )}
        <Link
          href="/admin/empreendimentos"
          style={{ ...button(), textDecoration: "none", display: "inline-block" }}
        >
          Voltar
        </Link>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            ...button("primary"),
            opacity: saving || !dirty ? 0.5 : 1,
            cursor: saving || !dirty ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      {error && (
        <div
          style={{
            ...card,
            background: "#3a1818",
            borderColor: "#8b2a2a",
            marginTop: 20,
          }}
        >
          <strong>Erro:</strong> {error}
        </div>
      )}
    </main>
  );
}
