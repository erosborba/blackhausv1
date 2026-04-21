"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/Chip";

/**
 * Aba Perfis — switcher temporário admin ↔ corretor.
 *
 * Fase atual (Phase 0–4): single-user stub, role vive em
 * system_settings.current_role. Útil pra testar gates visuais — trocar
 * pra "corretor" no dev e ver o que fica escondido.
 *
 * Phase 5: esta aba vira lista de usuários (tabela `agents`) + convites.
 * O PATCH aqui desaparece; role vai vir de auth.users via Supabase Auth.
 */

type Role = "admin" | "corretor";

export function PerfisTab({ initialRole }: { initialRole: string }) {
  const [current, setCurrent] = useState<Role>(
    initialRole === "corretor" ? "corretor" : "admin",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(next: Role) {
    if (next === current) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "current_role", value: next }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "falha");
        return;
      }
      setCurrent(next);
      setSaved(true);
      // Força refresh da página pra re-avaliar gates do shell
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="perfil-card">
        <div className="perfil-current">
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Perfil ativo:</span>
          <span className={`perfil-chip ${current}`}>{current}</span>
        </div>
        <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.55 }}>
          Troca o role do usuário atual. Admin vê tudo; corretor perde
          acesso a Ajustes, Gestor, Revisão e algumas ações de inbox.
          Útil pra testar gates visuais.
        </p>
        <div className="perfil-switch">
          <button
            type="button"
            className={current === "admin" ? "is-active" : ""}
            onClick={() => switchTo("admin")}
            disabled={saving}
          >
            admin
          </button>
          <button
            type="button"
            className={current === "corretor" ? "is-active" : ""}
            onClick={() => switchTo("corretor")}
            disabled={saving}
          >
            corretor
          </button>
          {saved ? <Chip tone="ok">✓ salvo · recarregando…</Chip> : null}
          {error ? <Chip tone="hot">{error}</Chip> : null}
        </div>
        <p className="perfil-note">
          Na Phase 5 este painel vira lista de usuários com convite por
          email + tabela <code>agents</code> ligada a <code>auth.users</code>. O contrato{" "}
          <code>can(role, perm)</code> em <code>src/lib/auth/role.ts</code> não muda — só a
          fonte do role.
        </p>
      </div>
    </div>
  );
}
