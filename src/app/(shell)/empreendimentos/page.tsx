import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { supabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/auth/role";
import { getCurrentRole } from "@/lib/auth/role-server";
import type { Empreendimento } from "@/lib/empreendimentos-shared";
import { EmpreendimentosDashboard } from "./dashboard-client";
import "./dashboard.css";

export const dynamic = "force-dynamic";

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

  const canEdit = can(role, "empreendimentos.edit");
  const canCreate = can(role, "empreendimentos.create");

  return (
    <>
      <Topbar
        crumbs={[{ label: "Empreendimentos" }]}
        right={
          canCreate ? (
            <Link href="/admin/empreendimentos/new" className="top-cta">
              + Novo
            </Link>
          ) : null
        }
      />
      <div className="page-body">
        <EmpreendimentosDashboard initial={items} canEdit={canEdit} canCreate={canCreate} />
      </div>
    </>
  );
}
