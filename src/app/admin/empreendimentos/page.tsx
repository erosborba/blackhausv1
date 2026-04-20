import { supabaseAdmin } from "@/lib/supabase";
import type { Empreendimento } from "@/lib/empreendimentos";
import { EmpreendimentosDashboard } from "./dashboard-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadEmpreendimentos(): Promise<Empreendimento[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("empreendimentos")
    .select("*")
    .eq("ativo", true)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[admin/empreendimentos] load error:", error);
    return [];
  }
  return (data ?? []) as Empreendimento[];
}

export default async function EmpreendimentosListPage() {
  const items = await loadEmpreendimentos();
  return <EmpreendimentosDashboard initial={items} />;
}
