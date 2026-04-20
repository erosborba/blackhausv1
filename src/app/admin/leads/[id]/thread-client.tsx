"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export type Message = {
  id: string;
  direction: "inbound" | "outbound";
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
};

export type Lead = {
  id: string;
  phone: string;
  push_name: string | null;
  full_name: string | null;
  email: string | null;
  status: string | null;
  stage: string | null;
  qualification: Record<string, unknown>;
  agent_notes: string | null;
  human_takeover: boolean;
  last_message_at: string | null;
  brief: string | null;
  brief_at: string | null;
  created_at: string;
  memory?: string | null;
  memory_updated_at?: string | null;
};

const shell: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 320px",
  gap: 20,
  maxWidth: 1200,
  margin: "0 auto",
  padding: "24px 20px",
};

const card: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  overflow: "hidden",
};

const bubble = (direction: "inbound" | "outbound"): CSSProperties => ({
  maxWidth: "72%",
  padding: "10px 14px",
  borderRadius: 12,
  background: direction === "inbound" ? "#1c1c22" : "#1e3a5f",
  color: "#e7e7ea",
  fontSize: 14,
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
});

const metaLine: CSSProperties = {
  fontSize: 11,
  color: "#8f8f9a",
  marginTop: 4,
};

const sideLabel: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8f8f9a",
  marginBottom: 4,
};

const sideValue: CSSProperties = {
  fontSize: 14,
  color: "#e7e7ea",
  marginBottom: 12,
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderQualification(q: Record<string, unknown>) {
  const entries = Object.entries(q).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) {
    return <div style={{ color: "#8f8f9a", fontSize: 13 }}>Ainda não qualificado.</div>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.8 }}>
      {entries.map(([k, v]) => (
        <li key={k}>
          <span style={{ color: "#8f8f9a" }}>{k}:</span>{" "}
          <strong>{Array.isArray(v) ? v.join(", ") : String(v)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function ThreadClient({
  lead,
  initialMessages,
}: {
  lead: Lead;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [currentLead, setCurrentLead] = useState(lead);
  const [notesDraft, setNotesDraft] = useState(lead.agent_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function patchLead(patch: Record<string, unknown>) {
    setActionError(null);
    const res = await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      const msg = typeof json.error === "string" ? json.error : "Falha ao atualizar";
      setActionError(msg);
      throw new Error(msg);
    }
    return json.data as Lead;
  }

  async function togglePause() {
    setSavingToggle(true);
    try {
      const updated = await patchLead({ human_takeover: !currentLead.human_takeover });
      setCurrentLead((prev) => ({ ...prev, ...updated }));
    } catch {
      /* erro já em actionError */
    } finally {
      setSavingToggle(false);
    }
  }

  async function saveNotes() {
    setSavingNotes(true);
    try {
      const value = notesDraft.trim() === "" ? null : notesDraft;
      const updated = await patchLead({ agent_notes: value });
      setCurrentLead((prev) => ({ ...prev, ...updated }));
    } catch {
      /* erro já em actionError */
    } finally {
      setSavingNotes(false);
    }
  }

  async function takeOver() {
    if (!confirm("Assumir esta conversa? A Bia será pausada e um brief do lead vai ser gerado.")) return;
    setTakingOver(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/takeover`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao assumir");
      }
      setCurrentLead((prev) => ({ ...prev, ...(json.data as Lead) }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setTakingOver(false);
    }
  }

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`lead:${lead.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `id=eq.${lead.id}`,
        },
        (payload) => {
          setCurrentLead((prev) => ({ ...prev, ...(payload.new as Partial<Lead>) }));
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [lead.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Sincroniza textarea quando realtime recebe atualização externa.
  useEffect(() => {
    setNotesDraft(currentLead.agent_notes ?? "");
  }, [currentLead.agent_notes]);

  const notesDirty = (currentLead.agent_notes ?? "") !== notesDraft;

  const name = currentLead.full_name || currentLead.push_name || currentLead.phone;

  return (
    <main style={shell}>
      <section style={card}>
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #2a2a32",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <Link href="/admin/leads" style={{ color: "#8f8f9a", fontSize: 13, textDecoration: "none" }}>
              ← Inbox
            </Link>
            <h1 style={{ margin: "4px 0 0", fontSize: 18 }}>{name}</h1>
            <div style={{ color: "#8f8f9a", fontSize: 12 }}>{currentLead.phone}</div>
          </div>
          {currentLead.human_takeover && (
            <span
              style={{
                background: "#3a2b1e",
                color: "#d9a66b",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Bia pausada
            </span>
          )}
        </header>

        <div
          ref={scrollRef}
          style={{
            maxHeight: "calc(100vh - 200px)",
            minHeight: 400,
            overflowY: "auto",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ color: "#8f8f9a", textAlign: "center", marginTop: 40 }}>
              Nenhuma mensagem.
            </div>
          ) : (
            (() => {
              const items: Array<
                { kind: "msg"; m: Message } | { kind: "brief"; text: string; at: string }
              > = messages.map((m) => ({ kind: "msg" as const, m }));
              if (currentLead.brief && currentLead.brief_at) {
                const briefTime = new Date(currentLead.brief_at).getTime();
                let insertAt = items.length;
                for (let i = 0; i < items.length; i++) {
                  const it = items[i];
                  if (it.kind === "msg" && new Date(it.m.created_at).getTime() > briefTime) {
                    insertAt = i;
                    break;
                  }
                }
                items.splice(insertAt, 0, {
                  kind: "brief",
                  text: currentLead.brief,
                  at: currentLead.brief_at,
                });
              }
              return items.map((it, idx) => {
                if (it.kind === "brief") {
                  return (
                    <div
                      key={`brief-${it.at}-${idx}`}
                      style={{
                        alignSelf: "stretch",
                        background: "linear-gradient(135deg, #1a2440 0%, #1e2a48 100%)",
                        border: "1px solid #3b5998",
                        borderRadius: 12,
                        padding: 14,
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 16 }}>✨</span>
                          <strong style={{ fontSize: 13, color: "#c4d4ff" }}>
                            Brief da Bia pro corretor
                          </strong>
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            color: "#8fa4d9",
                            background: "#0f1730",
                            padding: "2px 8px",
                            borderRadius: 4,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          🔒 só você vê
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#e7e7ea",
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.5,
                        }}
                      >
                        {it.text}
                      </div>
                      <div style={{ ...metaLine, marginTop: 8, color: "#8fa4d9" }}>
                        {formatTime(it.at)}
                      </div>
                    </div>
                  );
                }
                const m = it.m;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      justifyContent: m.direction === "inbound" ? "flex-start" : "flex-end",
                      flexDirection: "column",
                      alignItems: m.direction === "inbound" ? "flex-start" : "flex-end",
                    }}
                  >
                    <div style={bubble(m.direction)}>{m.content}</div>
                    <div style={metaLine}>
                      {m.direction === "inbound" ? name : "Bia"} · {formatTime(m.created_at)}
                    </div>
                  </div>
                );
              });
            })()
          )}
        </div>
      </section>

      <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...card, padding: 20 }}>
          <div style={sideLabel}>Status</div>
          <div style={sideValue}>{currentLead.status ?? "—"}</div>

          <div style={sideLabel}>Estágio</div>
          <div style={sideValue}>{currentLead.stage ?? "—"}</div>

          <div style={sideLabel}>Telefone</div>
          <div style={sideValue}>{currentLead.phone}</div>
        </div>

        <div style={{ ...card, padding: 20 }}>
          <div style={sideLabel}>Qualificação</div>
          {renderQualification(currentLead.qualification)}
        </div>

        {currentLead.memory && currentLead.memory.trim().length > 0 && (
          <div style={{ ...card, padding: 20 }}>
            <div style={{ ...sideLabel, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span>Memória da Bia</span>
              {currentLead.memory_updated_at && (
                <span style={{ fontSize: 10, color: "#6a6a74", textTransform: "none", letterSpacing: 0 }}>
                  atualizada {new Date(currentLead.memory_updated_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "#c5c5d0",
                whiteSpace: "pre-wrap",
                marginTop: 8,
              }}
            >
              {currentLead.memory}
            </div>
          </div>
        )}

        <div style={{ ...card, padding: 20 }}>
          <div style={sideLabel}>Controle da Bia</div>
          <button
            onClick={togglePause}
            disabled={savingToggle}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 14,
              fontWeight: 500,
              cursor: savingToggle ? "not-allowed" : "pointer",
              background: currentLead.human_takeover ? "#1e3a2b" : "#3a2b1e",
              color: currentLead.human_takeover ? "#6bd99b" : "#d9a66b",
              opacity: savingToggle ? 0.6 : 1,
              marginBottom: 10,
            }}
          >
            {savingToggle
              ? "Atualizando…"
              : currentLead.human_takeover
              ? "▶ Retomar Bia"
              : "⏸ Pausar Bia"}
          </button>
          <button
            onClick={takeOver}
            disabled={takingOver}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 14,
              fontWeight: 500,
              cursor: takingOver ? "not-allowed" : "pointer",
              background: "#3b82f6",
              color: "#fff",
              opacity: takingOver ? 0.6 : 1,
              marginBottom: 6,
            }}
          >
            {takingOver ? "Gerando brief…" : "Assumir conversa"}
          </button>
          <div style={{ fontSize: 11, color: "#8f8f9a", lineHeight: 1.4 }}>
            {currentLead.human_takeover
              ? "Bia não responde. Mensagens do lead continuam registradas."
              : "Bia responde automaticamente às mensagens recebidas."}
          </div>
        </div>

        <div style={{ ...card, padding: 20 }}>
          <div style={sideLabel}>Dicas pra Bia (ocultas ao lead)</div>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Ex: Lead veio por indicação do Pedro, seja mais informal. Prefere WhatsApp à noite."
            style={{
              width: "100%",
              minHeight: 100,
              padding: "8px 10px",
              background: "#0b0b0d",
              border: "1px solid #2a2a32",
              borderRadius: 8,
              color: "#e7e7ea",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={saveNotes}
            disabled={!notesDirty || savingNotes}
            style={{
              marginTop: 8,
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              cursor: !notesDirty || savingNotes ? "not-allowed" : "pointer",
              background: notesDirty ? "#3b82f6" : "#2a2a32",
              color: notesDirty ? "#fff" : "#8f8f9a",
              opacity: savingNotes ? 0.6 : 1,
            }}
          >
            {savingNotes ? "Salvando…" : notesDirty ? "Salvar dicas" : "Salvo"}
          </button>
        </div>

        {actionError && (
          <div style={{ ...card, padding: 16, background: "#3a1818", borderColor: "#8b2a2a" }}>
            <div style={{ fontSize: 13, color: "#ffb3b3" }}>{actionError}</div>
          </div>
        )}
      </aside>
    </main>
  );
}
