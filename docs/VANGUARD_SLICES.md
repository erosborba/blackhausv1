# Vanguard — slices executáveis

Complemento tático de `VANGUARD.md`. Cada slice é uma unidade mergeable
(PR pequeno, DoD claro, invariants afetados listados). Marque `[x]`
conforme fechar, com data e hash de commit se quiser rastreabilidade.

Estrutura por slice:
- **O que**: escopo em 1 frase
- **Por que**: valor do slice isolado
- **Arquivos**: que precisam nascer ou mudar
- **DoD**: critérios objetivos pra marcar como feito
- **Invariants tocados**: quais I-N de VANGUARD.md o slice exerce

---

## Track 1 — Eval set + funil analítico

**Objetivo do track**: tornar toda mudança futura **mensurável antes do
merge**. Sem isso, qualquer prompt change é fé.

### [x] 1.1 · Eval harness infrastructure — 2026-04-21

- **O que**: Tabela `eval_conversations` + runner script `scripts/eval-run.mjs`
  que replica um turn ou uma sequência através de `runSDR()` e compara
  saída vs esperado.
- **Por que**: Fundação. Sem harness, nada que vem depois é sustentável.
- **Arquivos**:
  - `supabase/migrations/NNNN_eval_conversations.sql`
  - `scripts/eval-run.mjs`
  - `src/lib/eval.ts` (tipos + lógica de comparação)
- **Schema mínimo de `eval_conversations`**:
  ```
  id uuid pk
  title text
  -- Sequência de inputs do lead, em ordem
  lead_messages jsonb  -- [{content, media_type?}]
  -- Estado inicial do lead (qualification, stage, score, etc.)
  initial_lead jsonb
  -- O que esperamos na saída final
  expected jsonb
    -- { needsHandoff?, handoffReason?, stage?, scoreRange?, qualificationKeys?, mustMentionEmpreendimentoId? }
  tags text[]
  created_at timestamptz default now()
  ```
- **Runner**: pra cada conversa, monta lead sintético, roda cada msg em
  loop através de `runSDR()`, coleta estado final, compara com `expected`.
  Saída JSON + código 0/1.
- **DoD**:
  - [x] Migration aplicada (`20260421000003_eval_conversations.sql`)
  - [x] `npm run eval` roda vazio (0 casos) sem erro — endpoint
        `/api/eval/run` retorna `{total:0,passed:0,...}` e script sai 0
  - [x] Comparador de `expected` cobre 9 dimensões: `needsHandoff`,
        `handoffReason`, `handoffUrgency`, `stage`, `scoreRange`,
        `qualificationKeys`, `mustMentionEmpreendimentoId`,
        `replyMustContain`, `replyMustNotContain`
- **Invariants**: I-4 (evaluation-first), I-6 (determinismo)
- **Notas de implementação**:
  - Runner roda via API (`/api/eval/run`) pra reaproveitar `runSDR()` em
    processo Next — evita bootstrap de langgraph + checkpointer fora do app
  - Leads sintéticos usam `phone` prefixo `5555` + `id` `eval-<uuid>` —
    namespaced longe de leads reais; thread do checkpointer também
  - Gate: admin em dev + token `BH_EVAL_TOKEN` pra CI/CLI (setar em
    `.env.local`)

### [x] 1.2 · Seed eval set — 20 casos — 2026-04-21

- **O que**: 20 conversas reais de produção, anonimizadas, rotuladas com
  outcome esperado, cobrindo os 4 pilares.
- **Por que**: Set vazio não pega nada. Precisa massa crítica pra detectar
  regressão.
- **Cobertura obrigatória**:
  - 5 casos de **handoff decision**: 3 que devem escalar (lead_pediu_humano,
    objeção comercial, cliente quente), 2 que NÃO devem (curiosidade, spam)
  - 5 casos de **qualification extraction**: mensagem fala de quartos, faixa,
    bairro, prazo — espera-se que Bia extraia cada campo corretamente
  - 5 casos de **grounding**: pergunta sobre empreendimento X específico →
    resposta precisa citar sources matching empreendimento_id X
  - 5 casos de **tone/closing**: lead quer agendar → Bia propõe horário,
    não só "legal!"
- **Arquivos**:
  - `scripts/eval-seed.mjs` (insere casos de um JSON; idempotente por title)
  - `evals/seed.json` (os 20 casos)
- **DoD**:
  - [x] 20 casos no arquivo — 5 handoff, 5 qualification, 5 grounding
        (placeholders de empreendimento_id — veja notas), 5 tone/closing
  - [x] `npm run eval:seed` upserta; `npm run eval` roda os 20
  - [x] Pelo menos 16/20 passam — **baseline firmado em 18/20 (commit
        `44bb334`, 2026-04-21)**. Refinar pra 20/20 é pendência diferida
        P-1 em `VANGUARD.md > Pendências diferidas` (requer substituir 5
        placeholders `REPLACE_WITH_REAL_EMP_ID_*` por UUIDs reais do DB)
- **Notas de implementação**:
  - 5 casos de grounding usam `mustMentionEmpreendimentoId:
    REPLACE_WITH_REAL_EMP_ID_*` — antes de rodar, o operador substitui pelos
    UUIDs reais do banco ou filtra via `--tag=!grounding`
  - Seed é idempotente: upsert por `title` — re-rodar não duplica
- **Invariants**: I-4

### [x] 1.3 · `npm run eval` + CI gate — 2026-04-21

- **O que**: Script npm + GitHub Action que roda o eval em PRs que tocam
  agent/prompt.
- **Por que**: G-1 do VANGUARD. Automação sem isso é fé.
- **Arquivos**:
  - `package.json > scripts.eval` = `node scripts/eval-run.mjs`
  - `.github/workflows/eval.yml` (ou `.husky/pre-push` se não usamos GH
    Actions ainda)
- **Regras do gate**:
  - Trigger: diff em `src/agent/**`, `src/lib/lead-memory.ts`,
    `src/lib/copilot.ts`, `src/lib/brief.ts`
  - Baseline: último eval verde no main — commit hash arquivado em
    `evals/baseline.json`
  - Fail: > 10% regressão (ex.: 16→13 passes)
- **DoD**:
  - [x] `npm run eval` funciona localmente (hit em `/api/eval/run`)
  - [x] `npm run eval -- --update-baseline` grava `evals/baseline.json`
        com commit hash + case_results
  - [x] `node scripts/eval-run.mjs --gate=ci` compara e retorna exit 1
        se regressão > 10%
  - [x] GitHub Action `.github/workflows/eval.yml` criado (dormente até
        secrets serem setados — SUPABASE_*, ANTHROPIC_API_KEY,
        OPENAI_API_KEY, BH_EVAL_TOKEN)
  - [x] Baseline vazio commitado (primeira execução é free pass)
- **Notas de implementação**:
  - Gate trata baseline vazio como "primeira execução" — não bloqueia.
    Rode `npm run eval -- --update-baseline` local depois de um run 100%
    verde pra firmar o baseline real
  - Action roda `npm run build && npm start` antes de disparar o runner,
    porque o CLI bate em HTTP localhost:3000
- **Invariants**: I-4, G-1

### [x] 1.4 · Funnel analytics RPC + `/gestor/funnel` real — 2026-04-21

- **O que**: Substitui o funnel aproximado de `/admin/funnel` por RPC
  baseada em `lead_events` (que já temos) + página nova em `/gestor`.
- **Por que**: Saber onde Bia perde lead é pré-requisito pra priorizar
  prompt/flow.
- **Arquivos**:
  - `supabase/migrations/NNNN_pipeline_conversion_funnel.sql` (RPC)
  - `src/app/(shell)/gestor/funnel/page.tsx`
  - `src/lib/funnel-analytics.ts`
- **RPC signature**:
  ```sql
  pipeline_conversion_funnel(since_days int DEFAULT 30)
  RETURNS TABLE (
    stage text,
    entered bigint,
    exited_to_next bigint,
    dropped bigint,
    median_time_in_stage_h numeric,
    p90_time_in_stage_h numeric
  )
  ```
- **DoD**:
  - [x] RPC `pipeline_conversion_funnel(since_days int)` aplicada
        — returns stage, entered, exited_to_next, dropped, median_h, p90_h
  - [x] Página `/gestor/funnel` com barras + KPIs + bottleneck detection
  - [x] Exclui phone `5555*` no CTE `eligible_leads`
  - [x] TECH_DEBT.md: item "Funnel approximation" marcado como resolvido
  - [x] Link do `/gestor` pro `/gestor/funnel`
- **Invariants**: I-2 (exclui test phones), I-7 (audit-based)

### [x] 1.5 · RAG gap report — 2026-04-21

- **O que**: Dashboard admin que cruza `handoff_feedback.rating='tarde'`
  com mensagens do lead, pra identificar empreendimentos/tópicos que a
  Bia não conseguiu responder bem (RAG incompleto).
- **Por que**: Fecha o loop: corretor avalia "Bia segurou demais" →
  gestor sabe onde reforçar knowledge base.
- **Arquivos**:
  - `src/lib/rag-gap.ts`
  - `src/app/(shell)/gestor/rag-gaps/page.tsx`
- **Lógica**:
  - Pegar handoff_feedback com rating `tarde` ou `bom` nos últimos 30d
  - Pra cada lead, olhar últimas 10 mensagens antes do handoff_notified_at
  - Empreendimentos citados em sources → conta
  - Gap = empreendimentos citados MUITO + rating `tarde` (Bia segurou sem
    ter o que responder)
- **DoD**:
  - [x] `/gestor/rag-gaps` lista top 50 empreendimentos com gap score
  - [x] Fórmula: `gapScore = tarde - bom + tarde * 0.5` (tarde puxa
        positivo, bom puxa negativo)
  - [x] Click no "abrir conversa" leva ao inbox do último lead onde o
        empreendimento foi citado antes de um handoff tarde
  - [x] Link do `/gestor` pro `/gestor/rag-gaps`
- **Invariants**: I-3 (usa índices existentes), I-7 (cruzamento é
  puramente audit-based)

### [x] 1.6 · `/gestor/health` — regression dashboard — 2026-04-21

- **O que**: Dashboard operacional com as 3 métricas de G-3.
- **Por que**: Olho mágico contra drift silencioso.
- **Arquivos**:
  - `src/app/(shell)/gestor/health/page.tsx`
  - `src/lib/gestor-health.ts`
- **Cards**:
  - Taxa de handoff (7d vs 14d prévios)
  - Taxa de resposta do lead ao primeiro turno da Bia
  - Custo por lead atendido (ai_usage_log / novos leads)
  - Eval pass rate histórico (commit em `evals/history.jsonl`)
- **DoD**:
  - [x] Página `/gestor/health` renderiza 4 métricas (handoff rate,
        response rate, cost/lead, eval pass rate)
  - [x] Cor vermelha (`tone-hot`) se degradação > 20%, amarela em 10–20%
  - [x] Runner append pra `evals/history.jsonl` a cada execução
- **Notas de implementação**:
  - Cost converte USD pra BRL com fator `5` (grosseiro; refinar quando
    houver câmbio real)
  - Response rate é heurística (inbound após primeira outbound) — aceita
    no contexto de sinal, não medida contábil
- **Invariants**: I-3, G-3

---

## Track 2 — Agendamento real de visita

**Objetivo**: Bia marca visita fim-a-fim. Google Calendar + slot allocator
+ lembretes + pós-visita.

### [x] 2.1 · Schema availability + slot allocator
- Tabela `agent_availability` (agent_id, weekday, start_hour, end_hour,
  timezone default 'America/Sao_Paulo')
- Função pura `src/lib/slot-allocator.ts`: input = agents + duração;
  output = slots disponíveis nos próximos 7 dias
- Considera `visits` já marcadas (dedupe)
- DoD: 10 unit tests cobrindo overlap, weekend skip, timezone DST

### [x] 2.2' · `.ics` no booking (substitui Google Calendar OAuth)
- Decisão 2026-04-22: Google Calendar era otimização prematura pra
  1 corretor. `.ics` anexado no WhatsApp dá 80% do valor (lead e
  corretor adicionam no calendar nativo do celular) com 5% do custo.
- `src/lib/ics.ts` — gerador RFC 5545 puro + 10 unit tests
- `evolution.ts > sendDocument` — anexa arquivo no WhatsApp
- `book_visit` e `reschedule_visit` mandam `.ics` após o texto
- DoD: lead recebe arquivo, toca, evento aparece no Apple/Google Calendar

### [x] 2.3' · Bloqueios pontuais (substitui Calendar write-through)
- Decisão 2026-04-22: em vez de escrever no Google Calendar do
  corretor, corretor registra bloqueios (férias, consulta) direto
  na nossa agenda. Mesma UX, zero dependência externa.
- Tabela `agent_unavailability (agent_id, start_at, end_at, reason)`
- `slot-allocator.BusyVisit.duration_min` (novo campo opcional) trata
  como busy de duração arbitrária
- `/api/admin/agent-unavailability` CRUD
- UI em `/ajustes?tab=agenda` com seção "Bloqueios" por corretor
- DoD: bloqueio criado via UI some dos slots propostos pela Bia

### [x] 2.4 · Tool `propose_visit_slots`
- Substitui/complementa `check-availability.ts`
- Input: lead_id, empreendimento_id, preferred_date?
- Output: 3 slot candidates como string formatada pro Bia usar
- DoD: Bia propõe slots reais no prompt (eval case adicionado)

### [x] 2.5 · Tool `book_visit` v2
- Hoje `schedule-visit.ts` só grava; v2 deve:
  - Validar slot disponível (anti-double-book)
  - Criar evento no calendar
  - Emitir `lead_events` + `handoff_feedback` se visita foi marcada pós-handoff
  - Enviar confirmação WhatsApp pro lead
- DoD: fluxo E2E lead→confirmação em staging

### [x] 2.6 · Lembretes 24h + 2h
- Worker cron que varre `visits` com `scheduled_at` em [+23h, +25h] e
  [+1h, +3h] → dispara WhatsApp
- Tabela `visit_reminders_sent` pra idempotência
- DoD: 2 lembretes chegam pro lead de teste

### [x] 2.7 · Follow-up pós-visita
- Dia seguinte 9h (timezone lead) → Bia pergunta "como foi a visita?"
- Reagenda como novo `follow_up`
- DoD: msg chega; resposta do lead entra no qualification

### [x] 2.8 · Reagendamento + cancelamento
- Lead fala "não posso mais" → Bia propõe nova data
- Cancela evento do calendar
- DoD: fluxo funciona via eval + manual

### [x] 2.9 · UI /agenda atualizada
- Substitui placeholder por view semanal real (própria do corretor)
- Click em visita → /inbox/<lead_id>
- DoD: página funcional + responsiva

---

## Track 3 — Simulação financeira

**Objetivo**: Bia fala de parcela, não só preço.

**Ordem revista 2026-04-24**: a ordem original assumia que Bia chuta
preço e simula. Na discussão com o operador, entendemos que o risco
real não é a simulação — é simulação sem preço confiável. Por isso
adicionamos slice 3.0 (guardrail + kill switches), reordenamos
`check_mcmv` antes de `simulate_financing` (elegibilidade é mais segura
e de maior valor comercial), e deixamos `cities_fiscal` pro fim
(refinamento, não bloqueador).

### [x] 3.0 · Settings + guardrails + config adapter — 2026-04-24
- Migration `20260424000001_finance_settings.sql` com 8 settings:
  - `finance_enabled` — kill switch geral
  - `finance_simulate_enabled`, `finance_mcmv_enabled` — kill por tool
  - `finance_require_explicit_price` — guardrail (default true): Bia
    nunca simula sem preço vindo do lead ou de `preco_inicial`
  - `finance_default_entry_pct` (20), `finance_default_term_months` (360)
  - `finance_sbpe_rate_annual_bps` (1150), `finance_itbi_default_bps` (200)
- `src/lib/finance-config.ts` — adapter que lê via `getSettingBool`/
  `getSettingNumber` (TTL-cache 60s) e converte bps → decimal
- `src/lib/settings.ts`: novo helper `getSettingBool`
- `/ajustes` ganha grupo "Financiamento" com os 8 toggles
- DoD: admin desliga `finance_enabled` → tools são desregistradas em
  runtime (a ser garantido no slice 3.3/3.4 via checagem de `flags`)

### [x] 3.1 · Lib pura `src/lib/finance.ts` — 2026-04-24
- Funções puras (sem banco, sem env): `sbpe`, `sac`, `mcmvBand`,
  `fgtsEligible`, `itbi`
- Constantes: `MCMV_BANDS` (3 faixas urbano frozen), `MCMV_SOURCE_DATE`,
  `FGTS_MIN_MONTHS_CLT`, `FGTS_SFH_CEILING`
- **SBPE/Tabela Price**: `PMT = P·r / (1 − (1+r)^−n)`; edge case r=0
  vira P/n
- **SAC**: `first = P/n + P·r`, `last = (P/n)·(1+r)`,
  `totalInterest = r·P·(n+1)/2`
- **MCMV 2024**: urbano_1 até R$2.640 / teto R$264k / subsídio R$55k /
  4.25%; urbano_2 até R$4.400 / subsídio R$29k / 5.25%; urbano_3 até
  R$8.000 / sem subsídio / 8.16%
- **FGTS**: ≥36 meses CLT + primeiro imóvel + ≤R$1.5M (teto SFH)
- **Tests** (`finance.test.ts`): 39 casos cobrindo todos os caminhos
  feliz + inválidos. `npm run test:unit` verde (62/62 geral)
- DoD: atendido. Lib 100% testável sem mock de banco.

### [x] 3.4 · Tool `check_mcmv` (promovida pra antes do simulate) — 2026-04-24
- `src/agent/tools/check-mcmv.ts` — wrapper com side-effect (lê config)
- `src/lib/mcmv-response.ts` — função pura `computeMcmvResponse` que
  delega toda lógica à lib pura `mcmvBand()` + monta texto pt-BR
- Respeita `flags.mcmvEnabled` → retorna `{ok:false, reason:'mcmv_disabled'}`
- Texto inclui faixa, teto de imóvel, subsídio (quando >0), taxa anual
  em pt-BR, e fecha com "quer simular a parcela?"
- Handoff de casos edge:
  - `renda_invalida` (0, NaN) → Bia pede renda
  - `primeiro_imovel_nao_informado` (undefined) → Bia pergunta antes
  - `nao_primeiro_imovel` → oferece SBPE
  - `renda_acima_teto` → oferece SBPE como upgrade positivo
- 12 unit tests em `check-mcmv.test.ts` (74/74 total verde)
- **Eval case deferido pro 3.5**: Bia não invoca a tool sozinha até
  o prompt update; schema de `qualification` ainda não tem
  `renda`/`primeiro_imovel`

### [x] 3.3 · Tool `simulate_financing` — 2026-04-24
- `src/agent/tools/simulate-financing.ts` — wrapper com config
- `src/lib/simulation-response.ts` — função pura
  `computeSimulationResponse` (SBPE ou SAC, defaults inteligentes,
  formatação pt-BR)
- **Guardrail implementado**: se `flags.requireExplicitPrice=true`
  (default) e `price_source` não é `'lead'` nem `'empreendimento'`,
  retorna `{ok:false, reason:'needs_price'}` com texto pedindo o
  valor ao lead. Admin pode afrouxar via `/ajustes`.
- Texto cola "a partir de" automaticamente quando
  `price_source='empreendimento'` — lead entende que é faixa, não
  preço da unidade
- SBPE mostra parcela constante + convite pra SAC; SAC mostra
  "começa em X, termina em Y" + convite pra SBPE. Ambos alertam
  sobre custos extras (condomínio/IPTU/taxas do banco)
- Validação: preço/prazo/entrada inválidos, entrada ≥ preço → reasons
  específicos com texto pedagógico
- 24 unit tests em `simulate-financing.test.ts` (98/98 total verde)
- **Eval case deferido pro 3.5**: depende de prompt/tool_use

### [x] 3.2 · Tabela cidades + ITBI — 2026-04-24
- Migration `20260424000002_cities_fiscal.sql`: tabela
  `cities_fiscal(cidade_slug, uf, cidade_display, itbi_bps,
  reg_cartorio_bps, source, updated_at)` com PK (cidade_slug, uf)
- Seed com 54 rows: 27 capitais + 27 metropolitanas/regionais,
  alíquotas ITBI de 2024 em bps (SP/RJ/MG/DF/BH/Salvador/Recife/POA=300,
  Curitiba=270, Contagem/Teresina=250, Maceió=150, demais=200)
- `src/lib/city-slug.ts` — funções puras `citySlug()` (NFD +
  lowercase + dash-collapse) e `normalizeUf()` (validação /^[A-Z]{2}$/)
- `src/lib/cities-fiscal.ts` — `getCityFiscal()` + `resolveItbiBps()`
  com TTL-cache 5min (cidades mudam raramente; mais agressivo que o
  60s de `system_settings`). Fallback silencioso em erro de DB
- 18 unit tests em `cities-fiscal.test.ts` (slug de acentos/caixa/
  pontuação/idempotência, UF normalização, compat contra os 54
  slugs do seed). 116/116 total verde
- `reg_cartorio_bps` fica nullable — emolumentos de registro são
  progressivos por tabela CNJ, difícil reduzir a um único bps.
  Fica como extensão futura quando valer a pena modelar
- **Integração com `simulate_financing` deferida pro slice 3.5**
  (prompt update) ou pra um slice 3.3b dedicado — a decisão
  (mostrar ITBI embutido ou em mensagem separada) depende de UX
  que só faz sentido quando a Bia já sabe invocar as tools

### [x] 3.5a · Modo copilot-only (fail-closed) — 2026-04-24
- **Motivação (decisão 2026-04-24)**: lead ancora em número. Cálculo
  contextualmente errado (taxa velha, ITBI errado, "primeiro imóvel"
  mal classificado) é assimetricamente ruim — 1 erro em 100 destrói
  confiança ganha nos outros 99. Corretor sanity-checka em segundos
  o que Bia calculou em 100ms. Human-in-the-loop de alta alavancagem.
- Migration `20260424000003_finance_copilot_mode.sql`: adiciona
  `finance_simulate_mode` e `finance_mcmv_mode` (default `copilot`)
- Migration `20260424000004_copilot_suggestions.sql`: tabela
  `copilot_suggestions(id, lead_id, kind, payload, text_preview,
  status, edited_text, discarded_reason, sent_message_id, meta)` com
  lifecycle pending → sent | discarded
- `src/lib/settings.ts`: novo `getSettingEnum<T>()` com validação
  contra lista fechada (fallback silencioso se valor inválido)
- `src/lib/finance-config.ts`: expõe `simulateMode`, `mcmvMode` em
  `FinanceFlags`; tipo `FinanceDeliveryMode = 'copilot' | 'direct'`
- `src/lib/copilot-promise.ts` (puro): `buildCopilotPromise({now, kind,
  nome})` devolve texto-promessa calibrado por horário de SP:
  - Seg-Sex 09–18h → "te chamo de volta em instantes"
  - Seg-Sex 18–22h → "te respondo ainda hoje"
  - Demais (noite/madrugada/fim de semana) → "amanhã cedo, no horário
    comercial"
  - **Invariant de safety**: nunca inclui R$, dígitos ou %
- `src/lib/copilot-suggestions.ts` (wrapper DB): `insertCopilotSuggestion`,
  `listPendingSuggestionsByLead`, `markSuggestionSent`,
  `markSuggestionDiscarded` (idempotentes via `.eq('status','pending')`)
- `src/agent/tools/simulate-financing.ts` + `check-mcmv.ts`:
  branch em `mode`. Em modo copilot: output de sucesso **não inclui
  os números** — Bia só vê o `text` (promessa) e `suggestion_id`.
  Fail-closed mesmo se Bia ignorar o prompt
- Fail em `ok:false` da função pura passa direto (sem copilot-gate) —
  são perguntas ao lead sem número vinculante
- Fail novo `missing_lead_id`: wrapper chama em copilot sem lead_id
  (programming error) → texto pede identificação ao lead
- 21 unit tests em `copilot-promise.test.ts` (buckets de horário +
  linguagem por kind + **invariant de safety numérica**). **137/137
  total verde**, tsc clean
- **UI exposure no /ajustes deferida pro 3.6** (precisa input enum,
  não cabe no pattern number/float atual)
- **Criação automática de handoff deferida pro 3.6**: por ora a
  sugestão fica pending orphaned; 3.6 surfaces no /inbox e decide
  política de notificar corretor

### [x] 3.5b · Prompt update — quando simular — 2026-04-24
- `SYSTEM_SDR` ganhou bloco "Regras de cálculos financeiros":
  nunca inventar parcela/subsídio/taxa; pedir preço-alvo antes
  de prometer simulação; pedir renda + primeiro_imovel antes de
  qualquer número MCMV; em copilot mode, repassar texto-promessa
  sem acrescentar estimativas próprias
- `ROUTER_SYSTEM` + prompt do `routerNode` extraem `renda` (number
  em BRL/mês) e `primeiro_imovel` (boolean) quando aparecem no turno.
  Critério `qualificar` estendido pra cobrir simulação sem preço e
  MCMV sem renda/primeiro_imovel
- `Qualification` type em `src/lib/leads.ts` ganhou campos opcionais
  `renda?: number` e `primeiro_imovel?: boolean`. Zero-migration
  (jsonb do banco já aceita)
- Eval harness: comparador ganhou dimensão `replyMustNotMatch`
  (regex case-insensitive) pra safety de números — substring não
  detecta "R$ 3.500", "parcela 2.800", "3%". Aceita forma pura ou
  `/pattern/flags`
- 5 eval cases novos (tag `3.5b`): extração de renda, extração
  dupla renda+primeiro_imovel, Bia pergunta renda quando MCMV
  mencionado, Bia pergunta preço quando simulação pedida sem
  âncora, safety crítico (lead dá todos os números e Bia mesmo
  assim NÃO inventa parcela)
- DoD: 137/137 unit tests verdes · tsc clean · evals/seed.json
  cobrindo ambos os modos · safety regex ataca R$/parcela/%/faixa

### [x] 3.6 · UI de sugestões do copilot no /inbox — 2026-04-24
Dividido em 3.6a (backend, sem UI) e 3.6b (UI + enum /ajustes).
3.6a consegue fechar sozinho porque corretor já recebe a
notificação de handoff pelo WhatsApp — o card só melhora a
experiência, não desbloqueia o fluxo.

#### [x] 3.6a · Backend do copilot (auto-handoff + send/discard) — 2026-04-24
- `src/lib/copilot-handoff.ts` — predicado puro
  `shouldCreateHandoffForSuggestion(lead)` decide se vale criar
  handoff. False quando lead já está em ponte, takeover humano
  ativo, ou handoff pendente (sem `handoff_resolved_at`). True
  quando handoff anterior já resolveu OU nunca existiu
- Wrapper inline em `copilot-suggestions.ts`
  (`maybeTriggerHandoffForSuggestion`): lê estado do lead, aplica
  o predicado, dispara `initiateHandoff(leadId, "ia_incerta",
  "baixa")`. Fail-soft — se Evolution cair, a sugestão já foi
  persistida com sucesso antes
- `ia_incerta` + `baixa` escolhidos de propósito: motivo canônico
  pra "Bia pede revisão", urgência baixa pra não furar o 🔴 dos
  leads realmente quentes
- `insertCopilotSuggestion` chama o wrapper após insert bem-sucedido
- `POST /api/suggestions/[id]/send` — corretor revisa + envia.
  Aceita `editedText` opcional (se corretor ajustou). Envia via
  Evolution, grava em `messages` com role="assistant" (origem Bia),
  marca sugestão `sent`, resolve handoff pending. NÃO ativa
  `human_takeover` (diferença vs `/leads/[id]/send`) — sugestão é
  override pontual, Bia continua no fluxo geral
- `POST /api/suggestions/[id]/discard` — motivo free-form (enum
  vem em 3.6b). Também resolve handoff
- `src/lib/copilot-stats.ts` — `getSuggestionStats(daysBack=7)`
  expõe `useRate = sent/(sent+discarded)` e
  `noEditRate = (sent-sentEdited)/sent`, além de top motivos de
  descarte. Null quando denominador zero (caller renderiza "—")
- 8 unit tests do predicado em `copilot-handoff.test.ts` cobrindo
  as 4 branches (clean/bridge/takeover/pending) + ciclo anterior
  fechado + belt-and-suspenders (bridge supera resolved) + null
- DoD: **145/145 unit tests verdes** · tsc clean · fluxo de
  auto-handoff + endpoints send/discard operacionais sem UI

#### [x] 3.6b · UI card + realtime + enum /ajustes — 2026-04-24
- `src/components/inbox/SuggestionsCard.tsx` (client): seção
  dentro do ContextRail que lista sugestões `pending` do lead
  ativo. Hook interno `useCopilotSuggestions(leadId)` faz carga
  inicial via `GET /api/suggestions?lead_id=...` + subscribe em
  `postgres_changes` (INSERT pra entrar / UPDATE status≠pending
  pra sair). Card se auto-oculta quando fila zera
- Cada card renderiza: badge do kind (simulação/MCMV) + relógio
  "time-ago" + **tabela mono-espaçada** com números do payload
  (preço/entrada/prazo/taxa/parcela/total pra simulation; faixa/
  renda/subsídio/teto/1º imóvel pra mcmv) + texto preview
- 3 modos de interação:
  - **Enviar**: POST `/api/suggestions/[id]/send` sem body → usa
    `text_preview` original
  - **Editar**: textarea inline pré-populado com `text_preview`;
    confirma com `editedText` no body → telemetria de edição
  - **Descartar**: dropdown enum de motivos (`calculo_errado`,
    `taxa_desatualizada`, `lead_ja_sabia`, `timing_ruim`,
    `vou_reformular`, `outro`); "outro" libera input livre
- `GET /api/suggestions?lead_id=<uuid>` — carga inicial + fallback
  se canal realtime desconectar. Gate: sessão (corretor logado)
- `/ajustes` (aba IA) ganha novo `inputType: "enum"` na SettingMeta
  renderizando `<select>` com labels pt-BR. Aplicado a
  `finance_simulate_mode` + `finance_mcmv_mode` (copilot/direto)
- `CopilotStatsCard` (server component) no topo da aba IA: useRate
  (%), noEditRate (%), contagem por status, top 5 motivos de
  descarte. Cores ok/warm/hot por threshold (≥70% ok, ≥40% warm,
  senão hot). "—" quando denominador zero
- DoD: fluxo E2E backend→UI fechado · tsc clean · 145 tests verdes
  (unit do 3.6a preservado; UI sem unit — cai em E2E posterior)

---

## Track 4 — TTS outbound

**Objetivo**: Bia responde áudio quando lead manda áudio. Humanização.

### [ ] 4.1 · Client ElevenLabs
- `src/lib/tts.ts` — synthesize(text, voiceId) → Buffer mp3
- Cache por hash (sha256(text+voice)) em Supabase Storage pra
  reaproveitar saudações comuns
- DoD: `node scripts/tts-test.mjs "oi!"` gera mp3

### [ ] 4.2 · Evolution `sendAudio`
- Extensão de `src/lib/evolution.ts` com `sendAudio({to, buffer, ptt:true})`
- DoD: áudio chega como PTT no WhatsApp

### [ ] 4.3 · Decision layer
- Novo node `decide-modality` no graph
- Regra: se últimas 3 msgs do lead tiveram ≥ 1 áudio → responde áudio
- Flag `lead.prefers_audio` memoizada
- DoD: eval case "lead manda áudio" → Bia responde áudio

### [ ] 4.4 · Fallback + budget
- Se ElevenLabs falha → manda texto
- Budget diário configurável em `system_settings.tts_daily_cap_brl`
- DoD: `ai_usage_log.kind='tts'` registra custo; cap funciona

### [ ] 4.5 · UI /inbox — bubble de áudio outbound
- Player inline + transcript pra corretor ler
- DoD: corretor escuta no inbox o que lead escutou

---

## Track 5 — Outreach event-triggered

**Objetivo**: Bia puxa lead de volta quando inventário mexe.

### [ ] 5.1 · Tabela `inventory_events`
- Triggers: UPDATE em `empreendimentos.preco_inicial` (drop > 3%),
  INSERT de empreendimento novo, UPDATE em `unidades.status`
  (sold_out / near_sold_out)
- Schema: empreendimento_id, kind, payload jsonb, at
- DoD: triggers gravam eventos; query `select * from inventory_events
  order by at desc limit 10` mostra real-time

### [ ] 5.2 · Matcher cron
- Worker 5x/dia que pega eventos novos, matcha contra `leads.qualification`
- Critério: bairro match ± 1 bairro vizinho, faixa preço ± 15%,
  quartos exato
- Output: `outreach_candidates` com (lead_id, event_id, score, proposed_at)
- Dedupe: nunca mesmo lead+empreendimento em < 14d
- DoD: matcher roda, produz candidates reais; dry-run disponível

### [ ] 5.3 · Personalização + envio
- Pra cada candidate: Bia gera mensagem usando `lead.memory` +
  empreendimento ref
- Template: "Oi {nome}, lembra que você me falou de {bairro}?
  Esse lançamento bate: {nome_emp}. Te mando detalhes?"
- Dispara via Evolution, grava `lead_events.kind='outreach_sent'`
- DoD: 10 leads de teste recebem; todos personalizados; opt-out disponível

### [ ] 5.4 · Guardrails
- Quiet hours: só envia 9h–20h local do lead (assume SP se não souber)
- Max 1 outreach/lead/7d
- Respeita `lead.outreach_opt_out=true`
- Stop-word na resposta ("parar", "não quero mais") → flipa opt_out +
  confirma
- DoD: simulação com 100 leads falsos → nenhum fora de horário, nenhum
  viola 7d, opt-out funciona

### [ ] 5.5 · Dashboard outreach
- `/gestor/outreach` — últimas 50 campanhas
- Métricas: enviadas, respondidas (< 24h), viraram agendamento
- DoD: dashboard mostra funil de outreach real

---

## Lessons learned (vai preenchendo por track)

### Track 1 — fechado 2026-04-21

Vide `VANGUARD.md > Lições aprendidas > Track 1` pro detalhe.
Resumo: harness está no ar mas precisa do primeiro run verde pra firmar
baseline. 15 dos 20 casos são auto-contidos; 5 de grounding esperam
substituição dos placeholders `REPLACE_WITH_REAL_EMP_ID_*`.

### Track 2
<!-- idem -->

### Track 3
<!-- idem -->

### Track 4
<!-- idem -->

### Track 5
<!-- idem -->
