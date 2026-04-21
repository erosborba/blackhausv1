"use client";

import { useState, useRef, useEffect } from "react";
import type { Role } from "@/lib/auth/role";

type Props = {
  name: string;
  email: string | null;
  role: Role;
};

/**
 * Chip do usuário logado no rodapé da Sidebar. Click → menu com
 * email + logout. Sem rota própria; logout chama POST /api/auth/logout
 * e redireciona pro /login.
 */
export function UserChip({ name, email, role }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = toInitials(name);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function onLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Mesmo se falhar, redireciona — cookie vai ser invalidado no
      // próximo request de qualquer jeito.
    }
    window.location.href = "/login";
  }

  return (
    <div className="user-chip-wrap" ref={ref}>
      <button
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${name} (${role})`}
      >
        {initials}
      </button>
      {open ? (
        <div className="user-menu" role="menu">
          <div className="user-menu-head">
            <div className="user-menu-name">{name}</div>
            {email ? <div className="user-menu-email">{email}</div> : null}
            <div className="user-menu-role">{role === "admin" ? "admin" : "corretor"}</div>
          </div>
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={onLogout}
          >
            Sair
          </button>
        </div>
      ) : null}
    </div>
  );
}

function toInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
