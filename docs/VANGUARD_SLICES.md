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
  - [ ] Pelo menos 16/20 passam (baseline atual aceita regressão, mas
        documente quais 4 falham no `VANGUARD.md > Lições`) — **PENDENTE
        primeiro run manual contra LLM real**
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

### [ ] 2.2 · Google Calendar OAuth
- `/ajustes/calendario` — corretor conecta conta
- Token + refresh_token guardados encrypted em `agent_integrations`
- DoD: conectar + listar próximos 5 eventos funciona

### [ ] 2.3 · Calendar write-through
- Quando visita é marcada → cria evento no calendar do corretor
- Inclui lead info, link /inbox/<id>, endereço do empreendimento
- DoD: evento aparece no Google Calendar em < 5s

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

### [ ] 3.1 · Lib pura `src/lib/finance.ts`
- Funções: `sbpe(principal, rate, months)`, `sac(principal, rate, months)`,
  `itbi(value, cityCode)`, `fgtsEligible({monthsClt, isFirstHome})`,
  `mcmvBand({renda, cidade, primeiroImovel})`
- Tests: 30 cases cobrindo cada função; inputs inválidos retornam erro
- DoD: `npm run test finance` 100% pass

### [ ] 3.2 · Tabela cidades + ITBI
- `cities_fiscal` (cidade text, uf text, itbi_rate numeric, reg_cartorio numeric)
- Seed: 30 capitais + regiões atendidas
- DoD: query por cidade funciona

### [ ] 3.3 · Tool `simulate_financing`
- Input: preco_imovel, entrada, prazo_meses, modalidade ('sbpe'|'sac')
- Output estruturado: parcela inicial, parcela final, juros totais, CET
- DoD: tool no registry, eval case adicionado

### [ ] 3.4 · Tool `check_mcmv`
- Input: renda_bruta, cidade, primeiro_imovel, idade
- Output: faixa MCMV, subsídio estimado, taxa efetiva, pode/não pode
- DoD: cobertura de todos faixas atuais; eval case

### [ ] 3.5 · Prompt update — quando simular
- System prompt: depois que lead fala de preço/financiamento, Bia oferece
  simular; nunca simula sem a renda
- DoD: eval do caso "lead menciona preço" → Bia pergunta ou simula

### [ ] 3.6 · Bubble "simulação" no /inbox
- Tipo especial `message.meta.kind='simulation'` com JSON estruturado
- Renderiza tabelinha inline, não texto bruto
- DoD: simulação enviada aparece como card no inbox

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
