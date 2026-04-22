import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Listagem admin foi migrada pro shell dashboard em /empreendimentos.
 * Mantido como redirect pra não quebrar links antigos; /admin/empreendimentos/[id]
 * e /admin/empreendimentos/new continuam funcionando (edição e criação).
 */
export default function AdminEmpreendimentosListRedirect() {
  redirect("/empreendimentos");
}
