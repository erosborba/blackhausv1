import { supabaseAdmin } from "@/lib/supabase";
import {
  formatPrecoRange,
  getUnidadesSummary,
  listAvailableUnidades,
  type Unidade,
} from "@/lib/unidades";

/**
 * Agent tool: check_availability.
 *
 * Dado um empreendimento (id ou slug) e filtros opcionais, retorna texto
 * resumido pra Bia injetar no turno. Mantém a saída em PT-BR, compacta,
 * pronta pra colar numa resposta.
 *
 * NB: A Bia ainda não faz tool-calling explícito (node answerNode gera
 * texto direto). Essa função existe pra o answerNode chamar quando o
 * intent é "duvida_empreendimento" e a mensagem menciona disponibilidade,
 * preço, quartos etc. Também é útil pro copilot no admin.
 */

export type CheckAvailabilityInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
  /** Filtro por tipologia_ref (ex: "2q-suite") — opcional. */
  tipologia?: string | null;
  /** Limite de unidades listadas no retorno. */
  maxUnits?: number;
};

export type CheckAvailabilityOutput = {
  ok: boolean;
  reason?: "not_found" | "no_units";
  empreendimento_id?: string;
  empreendimento_nome?: string;
  summary?: {
    total: number;
    avail: number;
    reserved: number;
    sold: number;
    price_range: string | null;
  };
  units?: Array<{
    id: string;
    numero: string;
    andar: number;
    tipologia_ref: string | null;
    preco: number | null;
  }>;
  /** Resumo em linguagem natural, pronto pra Bia enviar. */
  text: string;
};

export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<CheckAvailabilityOutput> {
  const emp = await resolveEmpreendimento(input);
  if (!emp) {
    return {
      ok: false,
      reason: "not_found",
      text: "Não encontrei esse empreendimento na base. Pode me confirmar o nome?",
    };
  }

  const [summary, available] = await Promise.all([
    getUnidadesSummary(emp.id),
    listAvailableUnidades(emp.id, input.tipologia ?? undefined),
  ]);

  if (summary.total === 0) {
    return {
      ok: false,
      reason: "no_units",
      empreendimento_id: emp.id,
      empreendimento_nome: emp.nome,
      text: `Ainda não tenho a matriz de unidades de ${emp.nome} carregada. Vou pedir pro corretor te passar os disponíveis na hora.`,
    };
  }

  const units = available.slice(0, input.maxUnits ?? 6).map((u) => ({
    id: u.id,
    numero: u.numero,
    andar: u.andar,
    tipologia_ref: u.tipologia_ref,
    preco: u.preco,
  }));
  const priceRange = formatPrecoRange(summary);

  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    summary: {
      total: summary.total,
      avail: summary.avail,
      reserved: summary.reserved,
      sold: summary.sold,
      price_range: priceRange,
    },
    units,
    text: formatAvailabilityText(emp.nome, summary, units, input.tipologia ?? null, priceRange),
  };
}

async function resolveEmpreendimento(
  input: CheckAvailabilityInput,
): Promise<{ id: string; nome: string } | null> {
  if (!input.empreendimento_id && !input.empreendimento_slug) return null;
  const sb = supabaseAdmin();
  let q = sb.from("empreendimentos").select("id, nome").eq("ativo", true).limit(1);
  if (input.empreendimento_id) q = q.eq("id", input.empreendimento_id);
  if (input.empreendimento_slug) q = q.eq("slug", input.empreendimento_slug);
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error("[agent] checkAvailability.resolve:", error.message);
    return null;
  }
  return (data as { id: string; nome: string } | null) ?? null;
}

function formatAvailabilityText(
  nome: string,
  summary: Awaited<ReturnType<typeof getUnidadesSummary>>,
  units: Array<{ numero: string; andar: number; tipologia_ref: string | null; preco: number | null }>,
  tipologia: string | null,
  priceRange: string | null,
): string {
  const tipoSuffix = tipologia ? ` (tipologia ${tipologia})` : "";
  if (summary.avail === 0) {
    return `${nome} está 100% vendido/reservado no momento${tipoSuffix}. Posso te sugerir empreendimentos similares?`;
  }
  const lines: string[] = [];
  lines.push(
    `${nome}: ${summary.avail} unidade(s) disponíveis${tipoSuffix}${priceRange ? `, ${priceRange}` : ""}.`,
  );
  if (units.length > 0) {
    const preview = units
      .slice(0, 3)
      .map((u) => {
        const priceStr = u.preco
          ? ` · ${u.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}`
          : "";
        return `${u.numero} (${u.andar}º andar${priceStr})`;
      })
      .join(", ");
    lines.push(`Exemplos: ${preview}.`);
  }
  return lines.join(" ");
}
