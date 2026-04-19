"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

type Tipologia = {
  quartos?: number;
  suites?: number;
  vagas?: number;
  area?: number;
  preco?: number;
};

type UploadedFile = {
  type: "pdf" | "sheet" | "image" | "other";
  name: string;
  path: string;
  size: number;
};

type FormState = {
  nome: string;
  construtora: string;
  status: "" | "lancamento" | "em_obras" | "pronto_para_morar";
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  preco_inicial: string;
  entrega: string;
  descricao: string;
  tipologias: Tipologia[];
  diferenciais: string;
  lazer: string;
};

const emptyForm: FormState = {
  nome: "",
  construtora: "",
  status: "",
  endereco: "",
  bairro: "",
  cidade: "",
  estado: "",
  preco_inicial: "",
  entrega: "",
  descricao: "",
  tipologias: [],
  diferenciais: "",
  lazer: "",
};

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

const button = (primary = false): CSSProperties => ({
  background: primary ? "#3b82f6" : "#2a2a32",
  color: primary ? "#fff" : "#e7e7ea",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 500,
});

export default function NovoEmpreendimentoPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState(false);

  async function handleExtract() {
    if (files.length === 0) return;
    setExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/admin/empreendimentos/extract", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Extração falhou");
      }
      setUploaded(json.files ?? []);
      const e = json.extracted ?? {};
      setForm({
        nome: e.nome ?? "",
        construtora: e.construtora ?? "",
        status: e.status ?? "",
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
      });
      setExtracted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      setError("Nome é obrigatório");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        nome: form.nome,
        construtora: form.construtora || undefined,
        status: form.status || undefined,
        endereco: form.endereco || undefined,
        bairro: form.bairro || undefined,
        cidade: form.cidade || undefined,
        estado: form.estado || undefined,
        preco_inicial: form.preco_inicial ? Number(form.preco_inicial) : undefined,
        entrega: form.entrega || undefined,
        descricao: form.descricao || undefined,
        tipologias: form.tipologias,
        diferenciais: form.diferenciais
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        lazer: form.lazer
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        midias: uploaded,
      };
      const res = await fetch("/api/admin/empreendimentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao salvar");
      }
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ margin: "0 0 24px", fontSize: 24 }}>Novo empreendimento</h1>

      <section style={card}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>1. Arquivos</h2>
        <p style={{ color: "#8f8f9a", margin: "0 0 12px", fontSize: 13 }}>
          Anexe o descritivo (PDF), tabela de valores (XLSX) e fotos. A IA vai
          extrair os dados automaticamente — você revisa antes de salvar.
        </p>
        <input
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,image/*"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          style={{ ...input, padding: 10 }}
        />
        {files.length > 0 && (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "#c7c7cf", fontSize: 13 }}>
            {files.map((f) => (
              <li key={f.name}>
                {f.name} <span style={{ color: "#8f8f9a" }}>({(f.size / 1024).toFixed(0)} KB)</span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 16 }}>
          <button
            onClick={handleExtract}
            disabled={extracting || files.length === 0}
            style={{
              ...button(true),
              opacity: extracting || files.length === 0 ? 0.5 : 1,
              cursor: extracting || files.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {extracting ? "Extraindo..." : "Extrair dados com IA"}
          </button>
        </div>
      </section>

      {extracted && (
        <>
          <section style={card}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>2. Revise os dados</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={label}>Nome*</label>
              <input style={input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={label}>Construtora</label>
                <input style={input} value={form.construtora} onChange={(e) => setForm({ ...form, construtora: e.target.value })} />
              </div>
              <div>
                <label style={label}>Status</label>
                <select style={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}>
                  <option value="">—</option>
                  <option value="lancamento">Lançamento</option>
                  <option value="em_obras">Em obras</option>
                  <option value="pronto_para_morar">Pronto para morar</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={label}>Endereço</label>
              <input style={input} value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={label}>Bairro</label>
                <input style={input} value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
              </div>
              <div>
                <label style={label}>Cidade</label>
                <input style={input} value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
              </div>
              <div>
                <label style={label}>UF</label>
                <input style={input} maxLength={2} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={label}>Preço inicial (R$)</label>
                <input style={input} type="number" value={form.preco_inicial} onChange={(e) => setForm({ ...form, preco_inicial: e.target.value })} />
              </div>
              <div>
                <label style={label}>Entrega</label>
                <input style={input} type="date" value={form.entrega} onChange={(e) => setForm({ ...form, entrega: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={label}>Descrição</label>
              <textarea style={{ ...input, minHeight: 90, resize: "vertical" }} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
          </section>

          <section style={card}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Tipologias</h2>
            {form.tipologias.map((t, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 10, marginBottom: 10 }}>
                <input style={input} placeholder="Quartos" type="number" value={t.quartos ?? ""} onChange={(e) => updateTipologia(i, { quartos: e.target.value ? Number(e.target.value) : undefined })} />
                <input style={input} placeholder="Suítes" type="number" value={t.suites ?? ""} onChange={(e) => updateTipologia(i, { suites: e.target.value ? Number(e.target.value) : undefined })} />
                <input style={input} placeholder="Vagas" type="number" value={t.vagas ?? ""} onChange={(e) => updateTipologia(i, { vagas: e.target.value ? Number(e.target.value) : undefined })} />
                <input style={input} placeholder="Área m²" type="number" value={t.area ?? ""} onChange={(e) => updateTipologia(i, { area: e.target.value ? Number(e.target.value) : undefined })} />
                <input style={input} placeholder="Preço R$" type="number" value={t.preco ?? ""} onChange={(e) => updateTipologia(i, { preco: e.target.value ? Number(e.target.value) : undefined })} />
                <button onClick={() => removeTipologia(i)} style={{ ...button(), padding: "0 12px" }}>×</button>
              </div>
            ))}
            <button onClick={addTipologia} style={button()}>+ Adicionar tipologia</button>
          </section>

          <section style={card}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>Diferenciais & Lazer</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={label}>Diferenciais (um por linha)</label>
                <textarea style={{ ...input, minHeight: 140, resize: "vertical" }} value={form.diferenciais} onChange={(e) => setForm({ ...form, diferenciais: e.target.value })} />
              </div>
              <div>
                <label style={label}>Lazer (um por linha)</label>
                <textarea style={{ ...input, minHeight: 140, resize: "vertical" }} value={form.lazer} onChange={(e) => setForm({ ...form, lazer: e.target.value })} />
              </div>
            </div>
          </section>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button onClick={() => router.push("/")} style={button()}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ ...button(true), opacity: saving ? 0.5 : 1 }}>
              {saving ? "Salvando..." : "Salvar empreendimento"}
            </button>
          </div>
        </>
      )}

      {error && (
        <div style={{ ...card, background: "#3a1818", borderColor: "#8b2a2a", marginTop: 20 }}>
          <strong>Erro:</strong> {error}
        </div>
      )}
    </main>
  );
}
