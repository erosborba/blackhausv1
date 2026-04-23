#!/usr/bin/env node
/**
 * Runner das 8 perguntas de validação da feature tabela-de-preços.
 * Bate em /api/eval/run-adhoc (endpoint efêmero) pra executar no grafo
 * real sem seed em eval_conversations. Pra isso, usa BH_EVAL_TOKEN.
 *
 * Requer: app rodando em APP_BASE_URL (default http://localhost:3000).
 *
 *   node scripts/eval-tabela-precos.mjs
 */

const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const TOKEN = process.env.BH_EVAL_TOKEN;
if (!TOKEN) { console.error("BH_EVAL_TOKEN missing em .env.local"); process.exit(1); }

const TESTS = [
  { tag: "1.1811", question: "Qual o valor da unidade 1811?" },
  { tag: "2.1812", question: "E da 1812?" },
  { tag: "3.studio-400", question: "Tem studio até 400 mil no AYA?" },
  { tag: "4.dois-quartos", question: "Me mostra opções de 2 quartos no AYA" },
  { tag: "5.loja", question: "Tem loja disponível no AYA?" },
  { tag: "6.inexistente", question: "Qual o valor da unidade 9999 do AYA?" },
  { tag: "7.institucional", question: "Qual a previsão de entrega do AYA Amintas?" },
  { tag: "8.mista", question: "No AYA, quanto fica a parcela mensal do studio mais barato?" },
];

async function run(q) {
  const res = await fetch(`${APP_BASE_URL}/api/eval/run-adhoc?token=${TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [q.question],
      initial_lead: {
        push_name: "Eval Bot",
        stage: "discover",
        // memória do lead já menciona AYA pra desambiguar empreendimento
        memory: "Lead está interessado no Aya Residences Amintas. Perfil: investidor.",
        qualification: {},
      },
    }),
  });
  return res.json();
}

for (const t of TESTS) {
  console.log(`\n=== ${t.tag}: ${t.question} ===`);
  try {
    const r = await run(t);
    if (!r.ok) {
      console.log(`  ERRO: ${r.error ?? "?"}`);
      continue;
    }
    console.log(`  reply: ${r.reply}`);
    console.log(`  intent=${r.intent} stage=${r.stage} conf=${r.rag_confidence ?? "?"}`);
    if (r.tabela_match_injected) console.log(`  [tabela_match injetada]`);
    if (r.needsHandoff) console.log(`  [→ handoff ${r.handoffReason ?? ""}]`);
  } catch (e) {
    console.log(`  EXC: ${e.message}`);
  }
}
