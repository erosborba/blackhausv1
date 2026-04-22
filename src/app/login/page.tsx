import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";
import "./login.css";

export const dynamic = "force-dynamic";

/**
 * /login — OTP code (6-10 dígitos conforme config do Supabase). Server
 * component checa sessão existente e redireciona se já logado.
 *
 * Query params:
 *   ?next=/pagina  → redireciona pra essa rota após login
 *   ?err=codigo    → mensagem de erro (vinda do middleware/callback)
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; err?: string }>;
}) {
  const { next, err } = await searchParams;
  const { user, agent } = await getSession();

  if (user && agent?.active) {
    redirect(safeNext(next));
  }

  const envLabel =
    process.env.NODE_ENV === "production" ? "produção" : "local";

  return (
    <main className="login-page">
      <div className="login-grain" aria-hidden="true" />

      <section className="login-panel login-panel-form">
        <header className="login-brand">
          <span className="login-mark" aria-hidden="true">lh</span>
          <span className="login-brand-text">Lumihaus</span>
          <span className={`login-env login-env-${envLabel === "produção" ? "prod" : "dev"}`}>
            {envLabel}
          </span>
        </header>

        <div className="login-card">
          {user && !agent ? (
            <div className="login-alert">
              Você entrou mas seu email ainda não está vinculado a nenhum
              corretor. Pede pro admin te cadastrar em <code>/ajustes</code>.
            </div>
          ) : null}
          {err ? <div className="login-alert">{errText(err)}</div> : null}

          <LoginForm next={safeNext(next)} />
        </div>

        <footer className="login-foot">
          <span>Acesso logado e auditado.</span>
          <span className="login-foot-sep">·</span>
          <span>Sem senha, sem link.</span>
        </footer>
      </section>

      <aside className="login-panel login-panel-display" aria-hidden="true">
        <div className="login-display-top">
          <span className="login-coord">25°26′ S · 49°16′ W</span>
          <span className="login-dot" />
        </div>

        <div className="login-display-hero">
          <h1 className="login-display-title">
            <span className="login-display-line">Lumi</span>
            <span className="login-display-line login-display-line-indent">haus</span>
          </h1>
          <div className="login-display-rule" />
          <p className="login-display-tag">
            SDR de empreendimentos novos. <br />
            <em>Curitiba.</em>
          </p>
        </div>

        <div className="login-display-bottom">
          <div className="login-display-meta">
            <span className="login-meta-label">Copiloto</span>
            <span className="login-meta-value">WhatsApp · Pipeline · Handoff</span>
          </div>
          <div className="login-display-year">
            {new Date().getFullYear()}
          </div>
        </div>
      </aside>
    </main>
  );
}

function safeNext(next: string | undefined): string {
  const fallback = "/brief";
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Barrar rotas legacy /admin/* — todas redirecionam pro shell, mas fazer
  // o fallback no login evita double-redirect e firma o contrato
  // "pós-login = /brief".
  if (next === "/admin" || next.startsWith("/admin/")) return fallback;
  return next;
}

function errText(code: string): string {
  switch (code) {
    case "missing_code":
      return "Link inválido — pede outro código.";
    case "exchange_failed":
    case "otp_expired":
      return "Link expirou ou já foi usado. Pede outro código.";
    case "access_denied":
      return "Acesso negado — o link não é mais válido.";
    case "no_agent":
      return "Seu email não está vinculado a nenhum corretor. Fala com o admin.";
    case "inactive":
      return "Seu acesso foi desativado. Fala com o admin.";
    case "oauth":
      return "Erro na autenticação — tenta de novo.";
    default:
      return "Não deu. Tenta de novo.";
  }
}
