import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import type { Empreendimento } from "@/lib/empreendimentos";
import { DetailClient } from "./detail-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ id: string }> };

export default async function EmpreendimentoDetailPage({ params }: PageProps) {
  const { id } = await params;
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("empreendimentos").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[admin/empreendimentos/[id]] load error:", error);
  }
  if (!data) notFound();

  return <DetailClient initial={data as Empreendimento} />;
}
