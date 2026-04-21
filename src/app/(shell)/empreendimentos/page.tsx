import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { supabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import { getUnidadesSummary, formatPrecoRange } from "@/lib/unidades";
import type { Empreendimento } from "@/lib/empreendimentos-shared";
import "./empreendimentos.css";

export const dynamic = "force-dynamic";

/**
 * /empreendimentos — lista + split view.
 *
 * Phase 3 é uma grade de cards. Cada card mostra: cover (primeiro image),
 * nome, bairro, status, preço inicial (do empreendimentos.preco_inicial OU
 * de unidades.min_preco) e contadores (total / avail).
 *
 * Split view (lista à esquerda, preview à direita) entra quando o usuário
 * clicar num card e o /empreendimentos/[id] detail page abrir.
 */
export default async function EmpreendimentosPage() {
  const role = await getCurrentRole();
  if (!can(role, "empreendimentos.view")) redirect("/brief");

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from("empreendimentos")
    .select("*")
    .eq("ativo", true)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[empreendimentos] load:", error.message);
  }
  const items = (rows ?? []) as Empreendimento[];

  // Carrega summary de unidades em paralelo (opcional — só funde se tiver).
  const summaries = await Promise.all(items.map((e) => getUnidadesSummary(e.id)));

  return (
    <>
      <Topbar
        crumbs={[{ label: "Empreendimentos" }]}
        right={
          can(role, "empreendimentos.create") ? (
            <Link href="/admin/empreendimentos" className="top-cta">
              + Importar
            </Link>
          ) : null
        }
      />
      <main className="page-body empreendimentos-page">
        <header className="empre-head">
          <div>
            <h1 className="display">Empreendimentos</h1>
            <p className="empre-sub">
              Base consultada pela Bia. Cada card mostra disponibilidade em
              tempo real via unidades. {items.length} ativos.
            </p>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="empre-empty">
            <div className="empty-title">Nenhum empreendimento cadastrado</div>
            <div className="empty-sub">
              {can(role, "empreendimentos.create") ? (
                <>
                  Vá em <Link href="/admin/empreendimentos">/admin/empreendimentos</Link>{" "}
                  pra importar um PDF e começar a popular a base.
                </>
              ) : (
                "Peça pro admin cadastrar os empreendimentos."
              )}
            </div>
          </div>
        ) : (
          <ul className="empre-grid">
            {items.map((e, i) => {
              const s = summaries[i];
              const gradient = coverGradient(e.nome);
              const precoRange = s.total > 0
                ? formatPrecoRange(s)
                : e.preco_inicial
                  ? `a partir de ${e.preco_inicial.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}`
                  : null;
              return (
                <li key={e.id} className="empre-card">
                  <Link href={`/empreendimentos/${e.id}`} className="empre-card-link">
                    <div className="empre-cover" style={{ background: gradient }}>
                      <div className="empre-cover-ph">{initials(e.nome)}</div>
                      <div className="empre-cover-fade" />
                      {e.status ? (
                        <span className={`empre-status-pill status-${e.status}`}>
                          {statusLabel(e.status)}
                        </span>
                      ) : null}
                    </div>
                    <div className="empre-card-body">
                      <div className="empre-card-name">{e.nome}</div>
                      <div className="empre-card-loc">
                        {[e.bairro, e.cidade].filter(Boolean).join(" · ") ||
                          e.endereco ||
                          "—"}
                      </div>
                      {precoRange ? (
                        <div className="empre-card-price">{precoRange}</div>
                      ) : null}
                      {s.total > 0 ? (
                        <div className="empre-card-avail">
                          <span className="pill-avail">{s.avail} disp.</span>
                          <span className="pill-total">de {s.total}</span>
                          {s.sold > 0 ? <span className="pill-sold">{s.sold} vend.</span> : null}
                        </div>
                      ) : (
                        <div className="empre-card-avail empty">
                          <span className="pill-total">sem unidades cadastradas</span>
                        </div>
                      )}
                      {e.tipologias && e.tipologias.length > 0 ? (
                        <div className="empre-card-typs">
                          {e.tipologias.slice(0, 3).map((t, ti) => (
                            <span key={ti} className="typ-chip">
                              {t.quartos != null ? `${t.quartos}q` : "—"}
                              {t.area != null ? ` · ${t.area}m²` : ""}
                            </span>
                          ))}
                          {e.tipologias.length > 3 ? (
                            <span className="typ-chip ghost">+{e.tipologias.length - 3}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

function statusLabel(s: Empreendimento["status"]): string {
  switch (s) {
    case "lancamento":
      return "Lançamento";
    case "em_obras":
      return "Em obras";
    case "pronto_para_morar":
      return "Pronto";
    default:
      return "—";
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Gradient determinístico por hash do nome — cada empreendimento ganha
 * uma "capa" única mesmo sem imagem real cadastrada. Simplifica serving
 * de mídias (que exige auth) na listagem.
 */
function coverGradient(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) | 0;
  const hue1 = Math.abs(h) % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 30% 22%), hsl(${hue2} 35% 14%))`;
}
