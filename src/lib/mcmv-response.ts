/**
 * Vanguard · Track 3 · Slice 3.4 — função pura que monta a resposta de
 * `check_mcmv`.  Vive em `src/lib/` e não importa nada com alias `@/*`
 * nem toca banco — isso permite testar standalone via
 * `node --test src/lib/__tests__/*.test.ts` sem bootstrap de Next.js.
 *
 * O wrapper com side-effect (lê config do system_settings) vive em
 * `src/agent/tools/check-mcmv.ts` e delega 100% pra esta função depois
 * de carregar a config.
 */
import { mcmvBand, MCMV_SOURCE_DATE, type McmvBand } from "./finance.ts";

export type McmvInputData = {
  renda: number;
  primeiro_imovel?: boolean;
  nome?: string | null;
};

export type McmvFlagsSubset = {
  mcmvEnabled: boolean;
};

export type McmvResponseOk = {
  ok: true;
  band: McmvBand;
  text: string;
  source_date: string;
};

export type McmvResponseFail = {
  ok: false;
  reason:
    | "mcmv_disabled"
    | "renda_acima_teto"
    | "nao_primeiro_imovel"
    | "renda_invalida"
    | "primeiro_imovel_nao_informado";
  text: string;
};

export type McmvResponse = McmvResponseOk | McmvResponseFail;

export function computeMcmvResponse(
  input: McmvInputData,
  flags: McmvFlagsSubset,
): McmvResponse {
  if (!flags.mcmvEnabled) {
    return {
      ok: false,
      reason: "mcmv_disabled",
      text: "Simulação de MCMV tá desativada no momento. Vou pedir pro corretor te explicar as opções.",
    };
  }

  if (!Number.isFinite(input.renda) || input.renda <= 0) {
    return {
      ok: false,
      reason: "renda_invalida",
      text: "Pra ver se você se encaixa no Minha Casa Minha Vida, me conta sua renda bruta mensal (valor aproximado já ajuda).",
    };
  }

  if (input.primeiro_imovel === undefined) {
    return {
      ok: false,
      reason: "primeiro_imovel_nao_informado",
      text: "Uma dúvida rápida pro MCMV: esse seria seu primeiro imóvel? (É um dos critérios do programa.)",
    };
  }

  const result = mcmvBand({
    renda: input.renda,
    primeiroImovel: input.primeiro_imovel,
  });

  if (!result.eligible) {
    if (result.reason === "nao_primeiro_imovel") {
      return {
        ok: false,
        reason: "nao_primeiro_imovel",
        text: "O MCMV só vale pra primeiro imóvel, então nesse caso não rola. Mas dá pra financiar pelo SBPE/SAC normal — posso simular se você quiser.",
      };
    }
    if (result.reason === "renda_acima_teto") {
      return {
        ok: false,
        reason: "renda_acima_teto",
        text: `Com essa renda${
          input.nome ? `, ${input.nome},` : ""
        } você fica acima do teto do MCMV (hoje em R$ 8.000/mês). Mas isso é até bom: abre caminho pro SBPE com taxa de mercado e imóveis mais caros. Posso simular?`,
      };
    }
    return {
      ok: false,
      reason: "renda_invalida",
      text: "Preciso de um valor de renda pra checar. Me passa um aproximado.",
    };
  }

  return {
    ok: true,
    band: result.band,
    text: buildText(result.band, input),
    source_date: MCMV_SOURCE_DATE,
  };
}

/**
 * Texto pt-BR pronto pro WhatsApp. Estrutura:
 *   - confirma faixa
 *   - números chave: teto imóvel, subsídio, taxa
 *   - abre próximo passo (simular parcela)
 */
function buildText(band: McmvBand, input: McmvInputData): string {
  const nome = input.nome ? `, ${input.nome}` : "";
  const teto = fmtBRL(band.maxPropertyValue);
  const subsidio =
    band.subsidyMax > 0 ? ` e subsídio de até ${fmtBRL(band.subsidyMax)}` : "";
  const taxa = (band.rateAnnual * 100).toFixed(2).replace(".", ",");
  const firstLine = `Com essa renda${nome}, você entra na ${band.label} do Minha Casa Minha Vida.`;
  const secondLine = `Dá pra financiar imóvel até ${teto}${subsidio}, com taxa em torno de ${taxa}% ao ano.`;
  const thirdLine = "Quer que eu simule a parcela em algum valor específico?";
  return `${firstLine} ${secondLine} ${thirdLine}`;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
