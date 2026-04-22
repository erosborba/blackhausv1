import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import { getSetting } from "@/lib/settings";
import { Topbar } from "@/components/shell/Topbar";
import { AjustesClient } from "./client";
import { UsageTab } from "@/components/ajustes/UsageTab";
import { ManutencaoTab } from "@/components/ajustes/ManutencaoTab";
import { ManutencaoHealthCard } from "@/components/ajustes/ManutencaoHealthCard";
import { loadCleanupSnapshot } from "@/lib/cleanup-snapshot";
import { PerfisTab } from "@/components/ajustes/PerfisTab";
import { AgendaTab } from "@/components/ajustes/AgendaTab";
import { CopilotStatsCard } from "@/components/ajustes/CopilotStatsCard";
import { getSuggestionStats } from "@/lib/copilot-stats";
import "./ajustes.css";

export const dynamic = "force-dynamic";

type TabKey = "ia" | "usage" | "manutencao" | "perfis" | "agenda";

const TAB_LABEL: Record<TabKey, string> = {
  ia: "IA & Operação",
  usage: "Usage & Custos",
  manutencao: "Manutenção",
  perfis: "Perfis",
  agenda: "Agenda",
};

export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const role = await getCurrentRole();
  if (!can(role, "ajustes.view")) {
    redirect("/brief");
  }

  const sp = await searchParams;
  const tab: TabKey =
    sp?.tab === "usage" ||
    sp?.tab === "manutencao" ||
    sp?.tab === "perfis" ||
    sp?.tab === "agenda"
      ? sp.tab
      : "ia";

  // Gate específico por aba — Usage e Perfis exigem perms adicionais.
  if (tab === "usage" && !can(role, "ajustes.costs")) redirect("/ajustes");
  if (tab === "manutencao" && !can(role, "ajustes.manutencao")) redirect("/ajustes");

  const currentRole = await getSetting("current_role", role);

  // Stats do copilot só são carregados quando a aba "IA" está ativa —
  // evita consulta desnecessária ao trocar de aba. 7 dias é default
  // razoável (produto novo, ainda calibrando).
  const copilotStats = tab === "ia" ? await getSuggestionStats(7) : null;
  const cleanupSnapshot = tab === "manutencao" ? await loadCleanupSnapshot() : null;

  return (
    <>
      <Topbar crumbs={[{ label: "Ajustes" }, { label: TAB_LABEL[tab] }]} />
      <main className="page-body ajustes-page">
        <header className="ajustes-head">
          <div>
            <h1 className="display">Ajustes</h1>
            <p className="ajustes-sub">
              Parâmetros do sistema, uso de IA, manutenção e perfis. Alterações
              em IA refletem na próxima mensagem.
            </p>
          </div>
          <nav className="ajustes-tabs-nav" aria-label="Abas">
            <TabLink active={tab === "ia"} href="/ajustes">
              IA
            </TabLink>
            {can(role, "ajustes.costs") ? (
              <TabLink active={tab === "usage"} href="/ajustes?tab=usage">
                Usage
              </TabLink>
            ) : null}
            {can(role, "ajustes.manutencao") ? (
              <TabLink
                active={tab === "manutencao"}
                href="/ajustes?tab=manutencao"
              >
                Manutenção
              </TabLink>
            ) : null}
            <TabLink active={tab === "agenda"} href="/ajustes?tab=agenda">
              Agenda
            </TabLink>
            <TabLink active={tab === "perfis"} href="/ajustes?tab=perfis">
              Perfis
            </TabLink>
          </nav>
        </header>

        <div className="ajustes-body">
          {tab === "ia" && copilotStats ? (
            <CopilotStatsCard stats={copilotStats} />
          ) : null}
          {tab === "ia" ? <AjustesClient /> : null}
          {tab === "usage" ? <UsageTab /> : null}
          {tab === "manutencao" && cleanupSnapshot ? (
            <>
              <ManutencaoTab />
              <ManutencaoHealthCard snapshot={cleanupSnapshot} />
            </>
          ) : null}
          {tab === "agenda" ? <AgendaTab /> : null}
          {tab === "perfis" ? <PerfisTab initialRole={currentRole} /> : null}
        </div>
      </main>
    </>
  );
}

function TabLink({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`ajustes-tab ${active ? "is-active" : ""}`}>
      {children}
    </Link>
  );
}
