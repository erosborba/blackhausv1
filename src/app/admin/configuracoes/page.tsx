"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Setting = {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
};

// --- estilos ---
const container: CSSProperties = {
  maxWidth: 680,
  margin: "0 auto",
  padding: "32px 20px",
};

const heading: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: "#e7e7ea",
  marginBottom: 6,
};

const subtitle: CSSProperties = {
  fontSize: 13,
  color: "#8f8f9a",
  marginBottom: 28,
};

const card: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  padding: "20px 24px",
  marginBottom: 16,
};

const label: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: "#8f8f9a",
  marginBottom: 4,
  display: "block",
};

const descText: CSSProperties = {
  fontSize: 12,
  color: "#8f8f9a",
  marginBottom: 12,
  lineHeight: 1.5,
};

const inputRow: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  background: "#0b0b0d",
  border: "1px solid #2a2a32",
  borderRadius: 8,
  padding: "8px 12px",
  color: "#e7e7ea",
  fontSize: 14,
  fontFamily: "inherit",
  width: 140,
};

const saveBtn: CSSProperties = {
  background: "#3b82f6",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const saveBtnDisabled: CSSProperties = {
  ...saveBtn,
  background: "#1e3a5f",
  color: "#6b9fd4",
  cursor: "not-allowed",
};

const successMsg: CSSProperties = {
  fontSize: 12,
  color: "#4ade80",
  marginLeft: 8,
};

const errorMsg: CSSProperties = {
  fontSize: 12,
  color: "#f87171",
  marginTop: 6,
};

const updatedAt: CSSProperties = {
  fontSize: 11,
  color: "#555560",
  marginTop: 8,
};

type SettingMeta = {
  label: string;
  unit: string;
  inputType: "number" | "float";
  min?: number;
  max?: number;
  step?: number;
  toDisplay: (v: string) => string;
  toStorage: (v: string) => string;
};

// Chaves com label amigável, unidade e conversões display ↔ storage
const META: Record<string, SettingMeta> = {
  handoff_escalation_ms: {
    label: "Tempo até escalar para o próximo corretor",
    unit: "minutos",
    inputType: "number",
    min: 1,
    max: 60,
    toDisplay: (v) => String(Math.round(Number(v) / 60_000)),
    toStorage: (v) => String(Math.round(Number(v) * 60_000)),
  },
  handoff_max_attempts: {
    label: "Máximo de corretores notificados por lead",
    unit: "corretores",
    inputType: "number",
    min: 1,
    max: 10,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  rag_strong_threshold: {
    label: "Limiar de confiança do RAG",
    unit: "(0.0 – 1.0)",
    inputType: "float",
    min: 0.1,
    max: 1,
    step: 0.05,
    toDisplay: (v) => Number(v).toFixed(2),
    toStorage: (v) => String(Number(v)),
  },
  inbound_debounce_ms: {
    label: "Espera para agrupar mensagens rápidas do lead",
    unit: "segundos",
    inputType: "float",
    min: 0.5,
    max: 30,
    step: 0.5,
    toDisplay: (v) => (Number(v) / 1000).toFixed(1),
    toStorage: (v) => String(Math.round(Number(v) * 1000)),
  },
  memory_refresh_every: {
    label: "Intervalo de atualização da memória do lead",
    unit: "mensagens",
    inputType: "number",
    min: 3,
    max: 50,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_enabled: {
    label: "Ativar follow-up automático",
    unit: "(0 = off, 1 = on)",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  followup_step_1_days: {
    label: "1º follow-up após última mensagem do lead",
    unit: "dias",
    inputType: "number",
    min: 1,
    max: 30,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_step_2_days: {
    label: "2º follow-up após o 1º sem resposta",
    unit: "dias",
    inputType: "number",
    min: 1,
    max: 60,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_step_3_days: {
    label: "3º follow-up (última chamada) após o 2º sem resposta",
    unit: "dias",
    inputType: "number",
    min: 1,
    max: 90,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_rate_per_min: {
    label: "Máximo de follow-ups enviados por minuto (anti-ban)",
    unit: "envios/min",
    inputType: "number",
    min: 1,
    max: 20,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_window_start: {
    label: "Janela de envio — hora inicial",
    unit: "h (0-23)",
    inputType: "number",
    min: 0,
    max: 23,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_window_end: {
    label: "Janela de envio — hora final",
    unit: "h (0-23)",
    inputType: "number",
    min: 1,
    max: 23,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  bridge_stale_hours: {
    label: "Auto-fechar ponte esquecida após (sem troca de mensagens)",
    unit: "horas",
    inputType: "number",
    min: 1,
    max: 240,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_min_msgs_lead: {
    label: "Mínimo de mensagens do lead para entrar no follow-up",
    unit: "mensagens",
    inputType: "number",
    min: 1,
    max: 20,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
};

function SettingRow({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const meta = META[setting.key];
  const [value, setValue] = useState(meta ? meta.toDisplay(setting.value) : setting.value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayLabel = meta?.label ?? setting.key;
  const unit = meta?.unit ?? "";

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const rawValue = meta ? meta.toStorage(value) : value;
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: setting.key, value: rawValue }),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.ok) {
      setError(json.error ?? "Erro ao salvar");
    } else {
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 3000);
    }
  }

  return (
    <div style={card}>
      <span style={label}>{displayLabel}</span>
      {setting.description && <p style={descText}>{setting.description}</p>}
      <div style={inputRow}>
        <input
          style={inputStyle}
          type="number"
          min={meta?.min}
          max={meta?.max}
          step={meta?.step ?? 1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        {unit && <span style={{ fontSize: 13, color: "#8f8f9a" }}>{unit}</span>}
        <button style={saving ? saveBtnDisabled : saveBtn} onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
        {saved && <span style={successMsg}>✓ Salvo</span>}
      </div>
      {error && <p style={errorMsg}>{error}</p>}
      <p style={updatedAt}>
        Atualizado em {new Date(setting.updated_at).toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/admin/settings", { cache: "no-store" });
    const json = await res.json();
    if (json.ok) setSettings(json.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={container}>
      <h1 style={heading}>Configurações</h1>
      <p style={subtitle}>Parâmetros do sistema editáveis sem necessidade de redeploy.</p>

      {loading ? (
        <p style={{ color: "#8f8f9a", fontSize: 14 }}>Carregando…</p>
      ) : settings.length === 0 ? (
        <p style={{ color: "#8f8f9a", fontSize: 14 }}>Nenhuma configuração disponível.</p>
      ) : (
        settings.map((s) => <SettingRow key={s.key} setting={s} onSaved={load} />)
      )}
    </div>
  );
}
