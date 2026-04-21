"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type LeadHit = {
  id: string;
  name: string;
  phone: string;
  score: number;
};

type Shortcut = {
  label: string;
  hint: string;
  href: string;
  keywords: string;
};

const SHORTCUTS: Shortcut[] = [
  { label: "Inbox", hint: "Lista de conversas", href: "/inbox", keywords: "inbox leads conversas chat" },
  { label: "Brief do dia", hint: "Panorama + prioridades", href: "/brief", keywords: "brief dia resumo dashboard" },
  { label: "Pipeline", hint: "Funil por estágio", href: "/pipeline", keywords: "pipeline funil estagio" },
  { label: "Agenda", hint: "Visitas e compromissos", href: "/agenda", keywords: "agenda visita compromisso" },
  { label: "Empreendimentos", hint: "Catálogo", href: "/empreendimentos", keywords: "empreendimentos imoveis catalogo" },
  { label: "Ajustes", hint: "Configurações do sistema", href: "/ajustes", keywords: "ajustes config settings" },
];

/**
 * Command palette ⌘K — busca leads por nome/telefone + atalhos de navegação.
 * Debounce de 180ms. Escape fecha, Enter navega, ↑↓ move seleção.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<LeadHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Toggle ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounce search
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setLeads([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/inbox/list?q=${encodeURIComponent(q.trim())}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (json.ok) {
          const hits = (json.data as Array<{
            id: string;
            full_name: string | null;
            push_name: string | null;
            phone: string;
            score: number;
          }>).slice(0, 8).map((l) => ({
            id: l.id,
            name: l.full_name ?? l.push_name ?? l.phone,
            phone: l.phone,
            score: l.score ?? 0,
          }));
          setLeads(hits);
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  // Filtrar shortcuts pelo query
  const matchedShortcuts = q.trim()
    ? SHORTCUTS.filter((s) =>
        (s.label + " " + s.keywords).toLowerCase().includes(q.toLowerCase().trim()),
      )
    : SHORTCUTS;

  const totalItems = leads.length + matchedShortcuts.length;

  function navigate(idx: number) {
    if (idx < leads.length) {
      router.push(`/inbox/${leads[idx]!.id}`);
    } else {
      const s = matchedShortcuts[idx - leads.length];
      if (s) router.push(s.href);
    }
    setOpen(false);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(totalItems - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && totalItems > 0) {
      e.preventDefault();
      navigate(cursor);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buscar"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4, 8, 16, 0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        paddingTop: "18vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card neu"
        style={{
          width: "min(560px, 92vw)",
          maxHeight: "60vh",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onInputKey}
          placeholder="Buscar leads por nome/telefone, ou ir pra…"
          style={{
            background: "transparent",
            border: "none",
            padding: "16px 18px",
            color: "var(--ink)",
            fontSize: 14,
            outline: "none",
            fontFamily: "inherit",
            borderBottom: "1px solid var(--hairline)",
          }}
        />
        <div style={{ overflowY: "auto", padding: "6px 0" }}>
          {leads.length > 0 ? (
            <SectionLabel>Leads {loading ? "…" : ""}</SectionLabel>
          ) : null}
          {leads.map((l, i) => (
            <ItemRow
              key={l.id}
              active={cursor === i}
              onMouseEnter={() => setCursor(i)}
              onClick={() => navigate(i)}
              left={
                <>
                  <span style={{ fontWeight: 500 }}>{l.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-4)", marginLeft: 8 }}>
                    {l.phone}
                  </span>
                </>
              }
              right={
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--ink-3)",
                  }}
                >
                  {l.score}
                </span>
              }
            />
          ))}
          {matchedShortcuts.length > 0 ? <SectionLabel>Ir pra</SectionLabel> : null}
          {matchedShortcuts.map((s, i) => {
            const idx = leads.length + i;
            return (
              <ItemRow
                key={s.href}
                active={cursor === idx}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => navigate(idx)}
                left={
                  <>
                    <span style={{ fontWeight: 500 }}>{s.label}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-4)", marginLeft: 8 }}>
                      {s.hint}
                    </span>
                  </>
                }
                right={
                  <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-mono)" }}>
                    ↵
                  </span>
                }
              />
            );
          })}
          {totalItems === 0 ? (
            <div
              style={{
                padding: 18,
                color: "var(--ink-4)",
                fontSize: 12.5,
                textAlign: "center",
              }}
            >
              Nada encontrado.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 18px 4px",
        color: "var(--ink-4)",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function ItemRow({
  active,
  left,
  right,
  onClick,
  onMouseEnter,
}: {
  active: boolean;
  left: React.ReactNode;
  right: React.ReactNode;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "10px 18px",
        background: active ? "var(--surface-3)" : "transparent",
        border: "none",
        color: "var(--ink)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 13,
        fontFamily: "inherit",
        transition: "background 80ms",
      }}
    >
      <span>{left}</span>
      <span>{right}</span>
    </button>
  );
}
