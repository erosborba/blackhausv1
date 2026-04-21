"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Aba Agenda — editor de disponibilidade dos corretores (Track 2 · Slice 2.9).
 *
 * Cada corretor tem N janelas `agent_availability` (weekday + start/end minutos).
 * O slot-allocator consome essas janelas pra montar sugestões de visita.
 *
 * UX: lista de corretores; pra cada um, grid seg→dom com chips de janela e um
 * form inline pra adicionar nova janela. Delete é soft (active=false).
 *
 * Sem drag-resize nem multi-select — mantém intencionalmente simples. Fluxo
 * mais rico (copiar semana, bloqueios pontuais) fica pro Track 3.
 */

type Agent = {
  agent_id: string;
  agent_name: string;
  agent_phone: string;
  active: boolean;
  windows: Array<{
    id: string;
    weekday: number;
    start_minute: number;
    end_minute: number;
    timezone: string;
  }>;
};

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // seg→dom (brasileiro)

export function AgendaTab() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/agent-availability", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "falha ao carregar");
        return;
      }
      setAgents(json.data as Agent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <div className="ajustes-error">Erro: {error}</div>;
  }
  if (!agents) {
    return <div className="ajustes-loading">Carregando…</div>;
  }
  if (agents.length === 0) {
    return (
      <div className="ajustes-empty">
        <strong>Nenhum corretor cadastrado.</strong>
        <p>Adicione na tabela `agents` via Supabase antes de configurar horários.</p>
      </div>
    );
  }

  return (
    <div className="agenda-editor">
      <header className="agenda-editor-head">
        <h2>Disponibilidade dos corretores</h2>
        <p>
          Janelas de horário em que cada corretor aceita visitas. A Bia usa isso pra
          sugerir horários ao lead. Fuso: America/Sao_Paulo.
        </p>
      </header>

      {agents.map((agent) => (
        <AgentBlock key={agent.agent_id} agent={agent} onChange={load} />
      ))}
    </div>
  );
}

function AgentBlock({ agent, onChange }: { agent: Agent; onChange: () => void }) {
  const byWeekday = useMemo(() => {
    const m = new Map<number, Agent["windows"]>();
    for (const w of agent.windows) {
      if (!m.has(w.weekday)) m.set(w.weekday, []);
      m.get(w.weekday)!.push(w);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.start_minute - b.start_minute);
    return m;
  }, [agent.windows]);

  return (
    <section className="agent-block">
      <header className="agent-block-head">
        <div>
          <div className="agent-name">{agent.agent_name}</div>
          <div className="agent-phone">{agent.agent_phone}</div>
        </div>
        {!agent.active ? <span className="agent-inactive">inativo</span> : null}
      </header>

      <div className="agent-week-grid">
        {WEEKDAY_ORDER.map((wd) => (
          <div key={wd} className="agent-day-col">
            <div className="agent-day-head">{WEEKDAY_LABELS[wd]}</div>
            <div className="agent-day-windows">
              {(byWeekday.get(wd) ?? []).map((w) => (
                <WindowChip key={w.id} window={w} onDeleted={onChange} />
              ))}
              {!byWeekday.has(wd) ? <div className="agent-day-empty">—</div> : null}
            </div>
          </div>
        ))}
      </div>

      <AddWindowForm agentId={agent.agent_id} onCreated={onChange} />
    </section>
  );
}

function WindowChip({
  window: w,
  onDeleted,
}: {
  window: Agent["windows"][number];
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    if (!confirm(`Remover janela ${fmtHHMM(w.start_minute)}–${fmtHHMM(w.end_minute)}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/agent-availability?id=${w.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.ok) alert(`Erro: ${json.error ?? "falha"}`);
      else onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="window-chip" onClick={remove} disabled={busy} title="Remover">
      <span className="window-chip-label">
        {fmtHHMM(w.start_minute)}–{fmtHHMM(w.end_minute)}
      </span>
      <span className="window-chip-x" aria-hidden>
        ×
      </span>
    </button>
  );
}

function AddWindowForm({
  agentId,
  onCreated,
}: {
  agentId: string;
  onCreated: () => void;
}) {
  const [weekday, setWeekday] = useState(1); // seg default
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const s = hhmmToMinutes(start);
    const en = hhmmToMinutes(end);
    if (s === null || en === null) {
      setErr("horário inválido (use HH:MM)");
      return;
    }
    if (en <= s) {
      setErr("fim precisa ser maior que início");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/agent-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          weekday,
          start_minute: s,
          end_minute: en,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ?? "falha");
        return;
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-window-form" onSubmit={submit}>
      <label>
        <span>Dia</span>
        <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAY_ORDER.map((wd) => (
            <option key={wd} value={wd}>
              {WEEKDAY_LABELS[wd]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Início</span>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        <span>Fim</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <button type="submit" disabled={busy} className="add-window-btn">
        {busy ? "Adicionando…" : "+ Adicionar janela"}
      </button>
      {err ? <span className="add-window-err">{err}</span> : null}
    </form>
  );
}

function fmtHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 24 || m < 0 || m >= 60) return null;
  return h * 60 + m;
}
