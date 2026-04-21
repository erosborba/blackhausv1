import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";
import "./login.css";

export const dynamic = "force-dynamic";

/**
 * /login — magic-link. Server component checa se já está logado pra
 * redirecionar direto pro destino.
 *
 * Query params:
 *   ?next=/pagina  → redireciona pra essa rota após login
 *   ?err=codigo    → mostra mensagem de erro (do callback)
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; err?: string }>;
}) {
  const { next, err } = await searchParams;
  const { user, agent } = await getSession();

  // Já logado + mapeado → pro destino.
  if (user && agent?.active) {
    redirect(safeNext(next));
  }

  return (
    <main className="bh login-wrap">
      <section className="login-card">
        <div className="login-brand">
          <span className="login-logo-mark">bh</span>
          <span className="login-logo-text">Blackhaus</span>
        </div>
        <h1 className="login-title">Entrar</h1>
        <p className="login-sub">
          Mandamos um link mágico pro seu email cadastrado. Clica nele
          aqui mesmo pra entrar — sem senha.
        </p>
        {user && !agent ? (
          <div className="login-alert">
            Você entrou mas seu email ainda não está vinculado a nenhum
            corretor. Pede pro admin te cadastrar em <code>/ajustes</code>.
          </div>
        ) : null}
        {err ? <div className="login-alert">{errText(err)}</div> : null}
        <LoginForm next={safeNext(next)} />
        <p className="login-fine">
          Ao entrar você concorda em ter sua atividade logada pra auditoria
          operacional.
        </p>
      </section>
    </main>
  );
}

function safeNext(next: string | undefined): string {
  if (!next) return "/brief";
  if (!next.startsWith("/") || next.startsWith("//")) return "/brief";
  return next;
}

function errText(code: string): string {
  switch (code) {
    case "missing_code":
      return "Link inválido — pede outro.";
    case "exchange_failed":
    case "otp_expired":
      return "Link expirou ou já foi usado. Pede outro.";
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
