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

type UnavailabilityRow = {
  id: string;
  agent_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  active: boolean;
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

      <UnavailabilitySection agentId={agent.agent_id} />
    </section>
  );
}

/**
 * Bloqueios pontuais (Slice 2.3') — férias, consulta, folga. Busca
 * direto da API pra cada agent block; poderia ser pré-carregado no
 * parent, mas o volume é baixo (poucos bloqueios por corretor) e
 * deixar aqui mantém o parent simples.
 */
function UnavailabilitySection({ agentId }: { agentId: string }) {
  const [blocks, setBlocks] = useState<UnavailabilityRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/agent-unavailability?agent_id=${encodeURIComponent(agentId)}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (json.ok) setBlocks(json.data as UnavailabilityRow[]);
    } catch {
      // silent — bloqueios são UX, não crítico
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm("Remover este bloqueio?")) return;
    const res = await fetch(
      `/api/admin/agent-unavailability?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    const json = await res.json();
    if (!json.ok) alert(`Erro: ${json.error ?? "falha"}`);
    else void load();
  }

  return (
    <div className="unavail-section">
      <div className="unavail-head">
        <span>Bloqueios (férias, consulta, folga)</span>
      </div>
      <ul className="unavail-list">
        {(blocks ?? []).map((b) => (
          <li key={b.id} className="unavail-item">
            <span className="unavail-range">
              {fmtDateTime(b.start_at)} → {fmtDateTime(b.end_at)}
            </span>
            {b.reason ? <span className="unavail-reason">{b.reason}</span> : null}
            <button
              type="button"
              className="unavail-remove"
              onClick={() => remove(b.id)}
              aria-label="Remover"
            >
              ×
            </button>
          </li>
        ))}
        {blocks && blocks.length === 0 ? (
          <li className="unavail-empty">Nenhum bloqueio futuro.</li>
        ) : null}
      </ul>
      <AddUnavailabilityForm agentId={agentId} onCreated={load} />
    </div>
  );
}

function AddUnavailabilityForm({
  agentId,
  onCreated,
}: {
  agentId: string;
  onCreated: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("18:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!startDate || !endDate) {
      setErr("data de início e fim obrigatórias");
      return;
    }
    // Monta ISO no timezone BR via new Date("YYYY-MM-DDTHH:MM-03:00")
    const start = new Date(`${startDate}T${startTime}:00-03:00`);
    const end = new Date(`${endDate}T${endTime}:00-03:00`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      setErr("data inválida");
      return;
    }
    if (end.getTime() <= start.getTime()) {
      setErr("fim precisa ser maior que início");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/agent-unavailability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          reason: reason.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ?? "falha");
        return;
      }
      setStartDate("");
      setEndDate("");
      setReason("");
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-unavail-form" onSubmit={submit}>
      <label>
        <span>Início</span>
        <div className="datetime-pair">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
      </label>
      <label>
        <span>Fim</span>
        <div className="datetime-pair">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </label>
      <label>
        <span>Motivo (opcional)</span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="férias, consulta…"
        />
      </label>
      <button type="submit" disabled={busy} className="add-window-btn">
        {busy ? "Adicionando…" : "+ Adicionar bloqueio"}
      </button>
      {err ? <span className="add-window-err">{err}</span> : null}
    </form>
  );
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
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
