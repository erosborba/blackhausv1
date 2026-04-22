"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";

type Setting = {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
};

type SettingMeta = {
  label: string;
  unit: string;
  group: "Handoff" | "RAG" | "Debounce" | "Memória" | "Follow-up" | "Mídia" | "Bridge" | "Financiamento" | "Voz (TTS)";
  inputType: "number" | "float" | "enum" | "text";
  min?: number;
  max?: number;
  step?: number;
  /**
   * Só pra inputType="enum" — valores permitidos (armazenados em DB
   * como string pura) e labels amigáveis em pt-BR. toDisplay/toStorage
   * ficam no-op (identidade) nesse caso — o select lida com o mapping.
   */
  options?: ReadonlyArray<{ value: string; label: string }>;
  toDisplay: (v: string) => string;
  toStorage: (v: string) => string;
};

const META: Record<string, SettingMeta> = {
  handoff_escalation_ms: {
    label: "Tempo até escalar para o próximo corretor",
    unit: "minutos",
    group: "Handoff",
    inputType: "number",
    min: 1,
    max: 60,
    toDisplay: (v) => String(Math.round(Number(v) / 60_000)),
    toStorage: (v) => String(Math.round(Number(v) * 60_000)),
  },
  handoff_max_attempts: {
    label: "Máximo de corretores notificados por lead",
    unit: "corretores",
    group: "Handoff",
    inputType: "number",
    min: 1,
    max: 10,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  rag_strong_threshold: {
    label: "Limiar de confiança do RAG",
    unit: "(0.0 – 1.0)",
    group: "RAG",
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
    group: "Debounce",
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
    group: "Memória",
    inputType: "number",
    min: 3,
    max: 50,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_enabled: {
    label: "Ativar follow-up automático",
    unit: "(0 = off, 1 = on)",
    group: "Follow-up",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  followup_step_1_days: {
    label: "1º follow-up após última mensagem do lead",
    unit: "dias",
    group: "Follow-up",
    inputType: "number",
    min: 1,
    max: 30,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_step_2_days: {
    label: "2º follow-up após o 1º sem resposta",
    unit: "dias",
    group: "Follow-up",
    inputType: "number",
    min: 1,
    max: 60,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_step_3_days: {
    label: "3º follow-up (última chamada) após o 2º",
    unit: "dias",
    group: "Follow-up",
    inputType: "number",
    min: 1,
    max: 90,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_rate_per_min: {
    label: "Máximo de follow-ups por minuto (anti-ban)",
    unit: "envios/min",
    group: "Follow-up",
    inputType: "number",
    min: 1,
    max: 20,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_window_start: {
    label: "Janela de envio — hora inicial",
    unit: "h (0-23)",
    group: "Follow-up",
    inputType: "number",
    min: 0,
    max: 23,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_window_end: {
    label: "Janela de envio — hora final",
    unit: "h (0-23)",
    group: "Follow-up",
    inputType: "number",
    min: 1,
    max: 23,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  followup_min_msgs_lead: {
    label: "Mínimo de mensagens do lead para entrar no follow-up",
    unit: "mensagens",
    group: "Follow-up",
    inputType: "number",
    min: 1,
    max: 20,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  media_audio_enabled: {
    label: "Transcrever áudios do lead",
    unit: "(0 = off, 1 = on)",
    group: "Mídia",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  media_image_enabled: {
    label: "Processar imagens (visão)",
    unit: "(0 = off, 1 = on)",
    group: "Mídia",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  media_max_size_mb: {
    label: "Tamanho máximo de mídia aceita",
    unit: "MB",
    group: "Mídia",
    inputType: "number",
    min: 1,
    max: 100,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  media_retention_days: {
    label: "Retenção de mídia no storage",
    unit: "dias",
    group: "Mídia",
    inputType: "number",
    min: 1,
    max: 365,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  bridge_stale_hours: {
    label: "Auto-fechar ponte esquecida após",
    unit: "horas",
    group: "Bridge",
    inputType: "number",
    min: 1,
    max: 240,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  finance_enabled: {
    label: "Ativar simulação financeira (kill switch geral)",
    unit: "(0 = off, 1 = on)",
    group: "Financiamento",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  finance_simulate_enabled: {
    label: "Habilitar tool simulate_financing (SBPE/SAC)",
    unit: "(0 = off, 1 = on)",
    group: "Financiamento",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  finance_mcmv_enabled: {
    label: "Habilitar tool check_mcmv (faixas + subsídio)",
    unit: "(0 = off, 1 = on)",
    group: "Financiamento",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  finance_simulate_mode: {
    label: "Modo de entrega da simulação (SBPE/SAC)",
    unit: "copilot = revisão humana · direto = Bia envia",
    group: "Financiamento",
    inputType: "enum",
    options: [
      { value: "copilot", label: "Copilot (revisão do corretor)" },
      { value: "direct", label: "Direto (Bia envia os números)" },
    ],
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  finance_mcmv_mode: {
    label: "Modo de entrega do MCMV (faixas + subsídio)",
    unit: "copilot = revisão humana · direto = Bia envia",
    group: "Financiamento",
    inputType: "enum",
    options: [
      { value: "copilot", label: "Copilot (revisão do corretor)" },
      { value: "direct", label: "Direto (Bia envia os números)" },
    ],
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  finance_require_explicit_price: {
    label: "Exigir preço explícito na simulação (recomendado)",
    unit: "(0 = off, 1 = on)",
    group: "Financiamento",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  finance_default_entry_pct: {
    label: "Entrada padrão quando lead não informa",
    unit: "%",
    group: "Financiamento",
    inputType: "number",
    min: 0,
    max: 90,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  finance_default_term_months: {
    label: "Prazo padrão quando lead não informa",
    unit: "meses",
    group: "Financiamento",
    inputType: "number",
    min: 60,
    max: 420,
    toDisplay: (v) => v,
    toStorage: (v) => v,
  },
  finance_sbpe_rate_annual_bps: {
    label: "Taxa SBPE anual (referência de mercado)",
    unit: "% a.a.",
    group: "Financiamento",
    inputType: "float",
    min: 1,
    max: 25,
    step: 0.05,
    toDisplay: (v) => (Number(v) / 100).toFixed(2), // 1150 bps → "11.50"
    toStorage: (v) => String(Math.round(Number(v) * 100)), // "11.50" → 1150
  },
  finance_itbi_default_bps: {
    label: "ITBI default (quando cidade não mapeada)",
    unit: "%",
    group: "Financiamento",
    inputType: "float",
    min: 0,
    max: 10,
    step: 0.05,
    toDisplay: (v) => (Number(v) / 100).toFixed(2), // 200 bps → "2.00"
    toStorage: (v) => String(Math.round(Number(v) * 100)),
  },
  tts_enabled: {
    label: "Ativar respostas em áudio (TTS)",
    unit: "(0 = off, 1 = on)",
    group: "Voz (TTS)",
    inputType: "number",
    min: 0,
    max: 1,
    toDisplay: (v) => (v === "true" ? "1" : "0"),
    toStorage: (v) => (Number(v) >= 1 ? "true" : "false"),
  },
  tts_daily_cap_usd: {
    label: "Teto diário de síntese (ElevenLabs)",
    unit: "USD — ~$2 cobre ~60k chars/dia",
    group: "Voz (TTS)",
    inputType: "float",
    min: 0,
    max: 100,
    step: 0.5,
    toDisplay: (v) => Number(v).toFixed(2),
    toStorage: (v) => String(Number(v)),
  },
  tts_voice_id: {
    label: "Voice ID (ElevenLabs)",
    unit: "vazio = usa ELEVENLABS_VOICE_ID do .env",
    group: "Voz (TTS)",
    // String alfanumérica (ex: GDzHdQOi6jjf8zaXhCYD). inputType="text"
    // evita o filtro de dígitos do <input type="number"> que mangling
    // o id (GDzHdQOi6jjf8zaXhCYD → "68").
    inputType: "text",
    toDisplay: (v) => v,
    toStorage: (v) => v.trim(),
  },
};

const GROUP_ORDER: SettingMeta["group"][] = [
  "Handoff",
  "RAG",
  "Debounce",
  "Memória",
  "Follow-up",
  "Mídia",
  "Voz (TTS)",
  "Bridge",
  "Financiamento",
];

export function AjustesClient() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setSettings(json.data);
        setError(null);
      } else {
        setError(json.error ?? "Falha ao carregar");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de rede");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <EmptyState variant="loading" title="Carregando ajustes..." />;
  if (error) return <EmptyState variant="error" title="Não foi possível carregar" hint={error} />;
  if (settings.length === 0) return <EmptyState title="Nenhum ajuste disponível" />;

  // Agrupa por grupo conhecido; settings sem META vão pra "Outros"
  const grouped = new Map<string, Setting[]>();
  for (const s of settings) {
    const meta = META[s.key];
    const group = meta?.group ?? "Outros";
    const arr = grouped.get(group) ?? [];
    arr.push(s);
    grouped.set(group, arr);
  }

  const orderedGroups = [...GROUP_ORDER, "Outros"].filter((g) => grouped.has(g));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {orderedGroups.map((group) => (
        <section key={group}>
          <h2
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--blue-ink)",
              marginBottom: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.1em",
            }}
          >
            {group}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {grouped.get(group)!.map((s) => (
              <SettingRow key={s.key} setting={s} onSaved={load} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

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
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: setting.key, value: rawValue }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Erro ao salvar");
      } else {
        setSaved(true);
        onSaved();
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de rede");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ padding: "16px 18px" }}>
      <div className="mono" style={{ marginBottom: 6 }}>
        {displayLabel}
      </div>
      {setting.description ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            margin: "0 0 12px",
            lineHeight: 1.55,
          }}
        >
          {setting.description}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {meta?.inputType === "enum" && meta.options ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--hairline-2)",
              borderRadius: 10,
              padding: "8px 12px",
              color: "var(--ink)",
              fontSize: 13,
              fontFamily: "inherit",
              minWidth: 260,
              outline: "none",
            }}
          >
            {meta.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : meta?.inputType === "text" ? (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--hairline-2)",
              borderRadius: 10,
              padding: "8px 12px",
              color: "var(--ink)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              width: 260,
              outline: "none",
            }}
          />
        ) : (
          <input
            type="number"
            min={meta?.min}
            max={meta?.max}
            step={meta?.step ?? 1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--hairline-2)",
              borderRadius: 10,
              padding: "8px 12px",
              color: "var(--ink)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              width: 120,
              outline: "none",
            }}
          />
        )}
        {unit ? (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{unit}</span>
        ) : null}
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        {saved ? <Chip tone="ok">✓ Salvo</Chip> : null}
        {error ? <Chip tone="hot">{error}</Chip> : null}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            color: "var(--ink-4)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {new Date(setting.updated_at).toLocaleString("pt-BR")}
        </span>
      </div>
    </Card>
  );
}
