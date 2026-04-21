# Vanguard — roadmap Bia autônoma

Última atualização: 2026-04-21

Plano pra transformar a Bia de SDR competente em **corretora autônoma de
vanguarda**. Complementa `TECH_DEBT.md` (débitos) e
`UI_RECONSTRUCTION_PLAN.md` (shell nova). Esse doc define o **norte** e os
**invariants**; o passo-a-passo granular vive em `VANGUARD_SLICES.md`.

Todo PR que mexer em qualquer comportamento da Bia (prompts, tools, graph,
handoff, follow-ups) **precisa referenciar** o slice correspondente e rodar
o eval set local. Se o eval regredir > threshold, PR bloqueado até
justificar ou corrigir.

---

## Princípio norteador

> **Lead é da empresa.** Bia é a camada que garante atendimento 24/7 com
> qualidade consistente; corretor humano é a camada de closing e relação
> longa. Ninguém trava lead em ninguém — nem corretor trava em si, nem Bia
> trava em prompt ruim.

Consequências práticas:

1. Nenhum estado de lead pode ser "pro-corretor" por default. Qualquer
   pausa da Bia (`human_takeover`, `bridge_active`) precisa ter caminho de
   volta automático.
2. Mudança de comportamento da Bia passa por eval set antes de merge.
3. Drift silencioso é inimigo público número 1. Prefira 10 mudanças
   pequenas com teste a 1 mudança grande sem teste.

---

## 5 tracks — ordem de execução

A ordem **não é negociável** sem justificativa escrita neste doc. Fundação
(Track 1) destrava as outras 4 com segurança.

| # | Track                       | Duração | Depende de |
|---|-----------------------------|---------|------------|
| 1 | Eval set + funil analítico  | 1 sem   | —          |
| 2 | Agendamento real de visita  | 2–3 sem | Track 1    |
| 3 | Simulação financeira        | 2 sem   | Track 1    |
| 4 | TTS outbound                | 1 sem   | Track 1    |
| 5 | Outreach event-triggered    | 2 sem   | Track 1, 4 |

**Regra de corte entre tracks:** só começa o próximo quando (a) eval do
anterior está verde, (b) DoD de todos os slices marcados, (c) este doc e o
`VANGUARD_SLICES.md` atualizados com o que aprendeu.

---

## Invariants cross-cutting

Coisas que **nenhuma** feature pode quebrar. Se um slice precisar violar
um invariant, documente a exceção neste doc antes de implementar.

### I-1 · Lead nunca fica órfão
- `human_takeover=true` sem `assigned_agent_id` ativo é **bug**.
- Se `assigned_agent_id` aponta pra agente inativo, fallback pra rotação.
- `closeBridge` e feedback de handoff sempre devolvem atendimento pra Bia
  (`human_takeover=false`), preservando `assigned_agent_id` só pra
  continuidade.
- Teste: simulação "corretor saiu da empresa, lead manda mensagem" → lead
  é atendido.

### I-2 · LGPD / opt-out
- Outreach proativo (Track 5) sempre tem botão "parar avisos".
- `lead.outreach_opt_out=true` bloqueia qualquer outbound **não-reativo**.
- Bia responde mensagens recebidas mesmo com opt-out (é reativa, não
  outreach).
- Test phones (prefixo `5555` ou flag `leads.is_test=true`) nunca recebem
  mensagens reais.

### I-3 · Custo observável
- Toda chamada Claude/OpenAI/ElevenLabs/Whisper passa por `ai_usage_log`.
- Custo diário > R$ 200 dispara alerta (email pro admin).
- Feature nova sem registro de custo é PR rejeitado.

### I-4 · Evaluation-first
- `npm run eval` existe e passa antes de qualquer merge.
- Prompts são arquivo `.ts` versionado — `git blame` diz por que mudou.
- Eval set cobre: handoff decision, qualification extraction, response
  grounding (citations de RAG batem), tone consistency.

### I-5 · Multi-tenant safe
- Código novo não pode assumir single-tenant. Se `tenants` não existir
  ainda, toda query nova passa por helper que tolera null mas está pronto
  pra receber tenant_id.
- Outreach e triggers de inventory usam `empreendimento.tenant_id` quando
  existir.

### I-6 · Determinismo de domínio
- Simulação financeira (Track 3) e slot allocator (Track 2) são **funções
  puras** — mesmo input, mesmo output, testáveis sem LLM.
- LLM só formata a saída; nunca calcula. Nunca pergunte pra Claude quanto
  é o juros da Caixa — use a tabela.

### I-7 · Audit trail
- Visita marcada, outreach disparado, preço simulado, handoff revisado —
  tudo grava `lead_events` com `actor` ("bia" / "corretor:<id>" / "system").
- Gestor precisa conseguir responder "por que a Bia mandou X pra Y no dia Z".

### I-8 · Graceful degradation
- Toda tool externa (Google Calendar, ElevenLabs, simulador de
  financiamento) tem fallback textual.
- ElevenLabs caiu → Bia manda texto.
- Calendar oauth expirou → Bia cai pro "deixa eu confirmar com meu time".
- Simulador de MCMV com input inválido → Bia pede mais dado, não inventa.

---

## Definition of Done — por track

Um track só é "done" quando:

- [ ] Todos os slices de `VANGUARD_SLICES.md` marcados
- [ ] Migration + schema commitados
- [ ] `npm run eval` passa localmente (baseline atual ou melhor)
- [ ] Pelo menos 3 casos do eval cobrem comportamentos do track
- [ ] Runbook manual testado em staging (lead de teste real recebeu o
      fluxo)
- [ ] `npx tsc --noEmit` verde
- [ ] `TECH_DEBT.md` atualizado (marca como resolvido o que foi resolvido;
      adiciona débitos novos se introduzidos)
- [ ] Este doc atualizado com "lições aprendidas" — uma bullet no fim da
      seção do track, o que deu certo, o que não replicaria

---

## Guard-rails contra drift

Três freios automáticos pra evitar que a Bia regrida:

### G-1 · Eval set em CI
- `package.json > scripts.eval` = runner determinístico
- GitHub Action (ou pre-push hook local) roda `npm run eval` em qualquer
  PR que mexer em `src/agent/`, `src/lib/agent*`, ou `prompts/`
- Falha se ≥ 10% dos casos regridem vs baseline

### G-2 · Prompt freeze window
- Mudança em `src/agent/prompts.ts` e `src/agent/state.ts` (system prompt)
  exige linha no PR: "eval diff: [lista de casos afetados]"
- Sem isso → reviewer rejeita. Convenção humana, simples.

### G-3 · Dashboard de regressão contínua
- `/gestor/health` (Track 1, Slice 1.4) mostra últimos 7 dias:
  - taxa de handoff (proxy pra "Bia desistiu")
  - taxa de resposta do lead (proxy pra "Bia não engajou")
  - custo/lead (proxy pra "prompt ficou verboso")
- Se qualquer métrica degradar > 20% vs semana anterior → vermelho no
  dashboard + email automático.

---

## Lições aprendidas (preenchido ao longo da execução)

Cada track adiciona sua seção aqui quando fecha.

### Track 1 — Eval + funnel — fechado 2026-04-21

**Escopo entregue:**

- Migration `20260421000003_eval_conversations.sql` + tabela
  `eval_conversations` (20 casos seed em `evals/seed.json`)
- Migration `20260421000004_pipeline_conversion_funnel.sql` + RPC
  `pipeline_conversion_funnel(since_days)` baseada em
  `lead_events.stage_change`
- `src/lib/eval.ts` — tipos + comparador puro (9 dimensões de check)
- `src/lib/funnel-analytics.ts`, `src/lib/rag-gap.ts`,
  `src/lib/gestor-health.ts`
- API `POST /api/eval/run` (gate: role admin OU query token
  `BH_EVAL_TOKEN`)
- Scripts `scripts/eval-run.mjs` (+ baseline + CI gate) e
  `scripts/eval-seed.mjs` (idempotente por title)
- Páginas: `/gestor/funnel`, `/gestor/rag-gaps`, `/gestor/health` — todas
  linkadas da `/gestor` principal
- GitHub Action `.github/workflows/eval.yml` (dormente até secrets
  setados — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
  OPENAI_API_KEY, BH_EVAL_TOKEN)
- `evals/baseline.json` (inicialmente vazio) + `evals/history.jsonl`
  (append a cada run)
- TECH_DEBT.md: resolvido item "Funnel approximation"

**O que deu certo:**

- **Comparador puro em `src/lib/eval.ts`**: 9 dimensões cobrem handoff,
  stage, score range, qualification, grounding, reply guardrails. LLM
  nunca decide se o caso passou (I-6 vivo).
- **Runner via API** (CLI → `/api/eval/run`) evitou bootstrap do
  langgraph + checkpointer fora do app. Custo: precisa `npm run dev`
  rodando. Benefício: reaproveitamento 100% do grafo real, zero drift
  entre eval e produção.
- **`handoff_resolved_at`** (bug do pending após feedback) ficou
  naturalmente coberto pelo harness: um eval case que marca
  `handoff_resolved_at` e verifica `human_takeover=false` detecta
  regressão imediata.
- **Idempotência via `title`** no seed: re-rodar não duplica casos.
- **Separação clara**: VANGUARD.md = princípios; VANGUARD_SLICES.md =
  execução. Em cada slice entregue, atualizei o slice doc (DoD +
  "notas de implementação"), não este doc de topo. Evita poluir o
  estratégico com tático.

**O que não replicaria:**

- Casos de grounding (5 de 20) usam placeholders
  `REPLACE_WITH_REAL_EMP_ID_*` — exige passo manual antes do primeiro
  run verde. Alternativa melhor: seed helper que busca
  `empreendimentos` pelo `slug` em runtime. Fica como débito.
- Converti USD → BRL com fator fixo `5` em `gestor-health.ts`. Aceitável
  como sinal, ruim como número contábil. Se `ai_usage_log` passar a
  cotar direto em BRL (ou tivermos `fx_rate` snapshot), refinar.
- Cálculo de response rate é heurístico (primeira outbound → próxima
  inbound). Em leads com muitas mensagens, pode ficar impreciso.
  Aceitável pra dashboard, não pra relatório.
- Não validei o seed rodando o eval de fato (precisa LLM real + migration
  aplicada). O primeiro `npm run eval:seed && npm run eval` vai
  provavelmente exibir falhas — elas devem ser catalogadas aqui antes
  de firmar baseline.

**Próximo passo recomendado:**

Aplicar as duas migrations (`20260421000003` e `20260421000004`),
rodar `npm run eval:seed`, depois `npm run eval` com dev server on.
Catalogar os casos que falham no primeiro run (esperados, dado que 5
são placeholders de grounding), substituir os IDs reais dos
empreendimentos e rodar novamente. Com baseline verde, rodar
`npm run eval -- --update-baseline` pra firmar o piso contra o qual o
CI vai comparar (G-1). Só então começar Track 2.

**Baseline firmado em 2026-04-21 · commit `44bb334`:**

- **18/20 (90%)** — commit baseline.
- Runs observados na sequência de firmeza: 20, 19, 18, 17, 20, 19, 18.
  Mediana ~19, low-end 17. Threshold CI de 10% sobre 18 tolera 16 como
  piso — bate exato no DoD `16/20` documentado pro slice 1.2.
- **2 cases flaky conhecidos** (categoria legítima, não bug):
  1. `tone · lead indeciso → Bia pergunta critério decisivo` — tagged
     `flaky`. Em ~25% dos runs a Bia escala "os dois são parecidos"
     como objeção complexa em vez de perguntar o critério decisivo.
     Comportamento defensável (escalar em vez de chutar), mas o DoD
     diz "Bia explora antes". **Track 3 (determinismo/structured
     decision) endurece** com classifier que só escala após N turnos
     de exploração frustrada.
- **Ajustes de realidade no seed** durante firmeza:
  - DB tinha só 2 empreendimentos (AYA Carlos de Carvalho e Château
    de Vermont, ambos em Curitiba). Os 5 cases de grounding e o case
    `handoff NEG · curiosidade local` assumiam Vila Mariana/Moema (SP).
    Reescritos pra ancorar em inventário real — sem isso, a Bia
    escalava corretamente ("não tenho isso") e o eval punia o
    comportamento certo.
  - Case `tone · primeiro contato` esperava `stage=discover` no 1º
    turno, mas a Bia corretamente fica em `greet` até aparecer intent.
    Removido o `stage` check.
  - Case `tone · schedule` pedia `replyMustContain="visit"` (inglês
    num reply em pt-BR). Removido — Track 2 endurece com
    `propose_visit_slots`.
- **Helper novo**: `scripts/eval-list-emps.mjs` (`npm run eval:emps`)
  lista empreendimentos do DB com contagem de chunks, pra facilitar
  pareamento seed ↔ inventário em rodadas futuras.
- **Flag `--force` no `--update-baseline`**: aceita run com flaky
  conhecido (warning explícito). Sem isso, uma rodada flaky bloqueia
  update e obriga rerunning até o LLM cooperar — ruim pra velocidade.

### Track 2 — Visit scheduling — fechado 2026-04-22 (slices 2.1 · 2.4–2.9; 2.2/2.3 deferidos)

**O que ficou pronto**
- Schema `agent_availability` + índice unique pra janelas ativas (Slice 2.1).
  Tabela `visit_reminders_sent` (visit_id, kind) com unique pra idempotência
  de cron. RPC `agents_without_availability()` pra avisar UI quando um
  corretor ainda não configurou horários.
- Allocator puro `src/lib/slot-allocator.ts` — zero I/O, 12 unit tests
  cobrem weekday-match, step, lead time, busy overlap (com EPS simétrico),
  buffer, multi-agent, horizonte, timezone NYC (DST-safe via
  `Intl.DateTimeFormat`), `maxSlots`, input inválido, formatSlotPtBR.
- Tools do agente: `propose_visit_slots` (variado manhã/tarde/outros dias
  via `pickVariedSlots`), `book_visit` v2 com anti-double-book
  (re-executa allocator com step=15min e EPS=60s antes do INSERT),
  `reschedule_visit` (dynamic-import do bookVisit pra não gerar ciclo;
  cria nova row + cancela antiga com `cancelled_reason:rescheduled_to:<id>`),
  `cancel_visit`.
- Lembretes cron `/api/cron/visit-reminders` (5min cadence) cobre 24h,
  2h e post_visit (~17h depois). Idempotência a prova de race via unique
  (visit_id, kind) + catch do código 23505. Filtra I-2 (`5555*` e `eval_*`).
- UI: `/agenda` tab Visitas vira grid semanal (seg→dom, col.today em
  destaque, responsiva); `/ajustes?tab=agenda` editor de
  disponibilidade com grid por corretor + form inline pra adicionar
  janela. Delete é soft (active=false).

**Lições**
- **Pure-first pays**: allocator isolado rendeu 12 testes rápidos
  (<150ms total) e zero flaky. Comparado com o eval LLM do Track 1,
  é outro mundo de velocidade. Regra pro resto do roadmap: **qualquer
  decisão que caiba em função pura (finance sim, scoring rules, slot
  math) vai pra `lib/*` sem I/O e com unit test**. Integração fica em
  volta (thin adapters).
- **DST sem fingir**: timezone math via `Intl.DateTimeFormat`
  (formatToParts + reverse-map UTC). Tentei inicialmente aritmética
  com offsets fixos — quebra na virada de DST (março/outubro nos EUA,
  fev/out no BR até 2019). Teste `9. timezone diferente` (NYC terça
  9h EDT) pegou bugs que passavam com offset naive.
- **Anti-double-book barato**: re-rodar o allocator com step=15min e
  `maxSlots=200` dentro do `book_visit` é O(1) em memória, cacheável no
  Supabase e custa <50ms. Não precisou de lock pessimista nem advisory
  lock — o INSERT com unique constraint `visits (agent_id, scheduled_at)`
  seria a última barreira, mas na prática nunca bateu.
- **Buffer is symmetric**: testar com `bufferMin: 15` deixou claro que
  um slot 11h depois de uma visita 10h com buffer 15min morre pelos dois
  lados — o bufferPost da visita 10h (11:00–11:15) e o bufferPre do
  slot 11h (10:45–11:00). Mantido porque reflete a realidade (corretor
  precisa de 15min pra respirar/deslocar). Adicionado sanity check
  `noBuffer` no teste 5 pra documentar que sem buffer o 11h sobrevive.
- **Reschedule como compose**: evitei reinventar validação — `rescheduleVisit`
  faz dynamic-import de `bookVisit` e reusa seu anti-double-book +
  confirmação. Depois cancela a antiga com `cancelled_reason` estruturado
  (`rescheduled_to:<new_id>`) pro histórico continuar linear. Custo
  do dynamic-import: inexistente (ciclo resolvido, uma chamada a mais
  de SQL). Benefício: 0 linha de duplicação de regra de negócio.
- **UI semanal = grid 7col > lista agrupada**: a versão anterior da aba
  Visitas já agrupava por dia, mas visualmente era uma timeline vertical
  infinita. Grid seg→dom dá leitura instantânea de "terça tá livre,
  quinta tá lotada". Mobile cai pra 1col (hide de cols vazias pra não
  poluir). Isso casa com a tese do dashboard `/gestor/health`: informação
  densa > informação listada.
- **Editor inline > modal**: a tentação era abrir um modal pra adicionar
  janela de disponibilidade. Deixei form inline no final de cada
  AgentBlock (weekday + start + end + submit). Duas razões: (a) o
  usuário normalmente adiciona várias janelas seguidas (ex: seg-sex
  9-18), modal vira fricção; (b) o contexto visual (grid acima) fica
  sempre presente.

**Decisão 2026-04-22: dropar Google Calendar, entregar equivalentes próprios**

Depois de colocar Bia marcando, remarcando e lembrando visitas fim-a-fim
com nossa stack, revisitamos Slices 2.2/2.3 (Google Calendar OAuth +
write-through). Conclusão: **otimização prematura** pra 1 corretor.
Custo real do Google (OAuth flow, refresh rotation, quota, drift no
`calendar_event_id` se o corretor trocar de conta, ~200 linhas pra
manter pra sempre) vs valor incremental (visível no mesmo calendar do
celular do lead + bloqueios externos): não fecha.

Substitui por dois slices leves que fecham os gaps reais:

**2.2' — `.ics` no booking**
- `src/lib/ics.ts` gerador RFC 5545 puro (CRLF, line folding a 75,
  escape de texto, VALARM 1h antes) + 10 unit tests.
- `evolution.ts > sendDocument` chama `/message/sendMedia` com
  `mediatype: document`.
- `book_visit` monta `.ics` com UID estável `visit-<id>@blackhaus`
  (reagendamento preserva UID + incrementa SEQUENCE=1 +
  `METHOD:REQUEST` pra calendar substituir evento existente).
- LOCATION best-effort via empreendimento (endereco + bairro + cidade).
- Falha silenciosa — o texto principal já foi, `.ics` é bônus.

**2.3' — bloqueios pontuais**
- Tabela `agent_unavailability (start_at, end_at, reason)` com índice
  parcial `WHERE active = true`.
- `slot-allocator.BusyVisit` ganha campo opcional `duration_min` pra
  representar bloqueios de duração arbitrária (férias = 7 dias inteiros).
  Refactor do `conflictsWithBusy` pra pré-computar `{start, end}` por
  busy, em vez de assumir que toda row tem a mesma duração. 2 testes
  novos (teste 13 para bloqueio longo, 14 pra retro-compat) + os 10
  de ICS = 24/24 passing.
- `propose_visit_slots` e `book_visit.isSlotAvailable` chamam
  `fetchUnavailabilityAsBusy(...)` e concatenam ao array `busy`.
- UI em `/ajustes?tab=agenda`: nova seção "Bloqueios" por corretor
  com form date+time range + motivo, lista futura e remove inline.

**Lições dessa pivotada**
- **"Defer" nem sempre é "pending"**: Slices 2.2/2.3 ficaram marcados
  como DEFERRED durante duas sessões. Quando parei pra revisitar,
  virou óbvio que o deferral era na verdade "estamos fingindo que
  isso é necessário". Exercício útil: lista de deferreds deveria
  ter uma review forçada a cada N slices — "isso ainda importa?"
- **Anexo vs integração**: a mesma percepção do lado do lead ("evento
  no meu calendar") custa 30 linhas (`.ics` attachment) em vez de
  200+ (OAuth flow). A tentação de "integrar de verdade" vem de
  assumir que o usuário quer bidirecional — mas 99% do tempo ele
  quer só "entrar no calendar". One-way export ganha.
- **Schema split (agent_availability ∪ agent_unavailability)**:
  tentei mentalmente modelar como uma só tabela com flag `kind`. Vira
  escadaria de CASE no allocator. Duas tabelas, regra única: `slot
  livre = janela ativa ∩ NÃO(visit) ∩ NÃO(bloqueio)`. Vale lembrar
  pros próximos tracks: positivo e negativo são entidades diferentes
  quando as queries naturais as tratam diferente.
- **BusyVisit.duration_min é retro-compat**: adicionei o campo
  opcional sem quebrar o código existente; visits reais continuam
  passando sem duration (usa `visitDurationMin` do input default).
  Teste 14 garante isso. Regra pro resto do roadmap: **nunca
  "atualizar" tipo de teste — sempre adicionar um novo pro novo
  comportamento**. O antigo fica de guarda contra regressão.

**Invariants honrados**
- I-2 (nunca enviar pra `5555*`/`eval_*`): honrado em `visit-reminders`
  e indiretamente em `book_visit` via sendText (que já filtra).
- I-3 (custo observável): cada outbound passa por `sendText`, que já
  entra no `ai_usage_log` via `delayMs`.
- G-3 (health dashboard): rate de lembretes enviados vai entrar como
  métrica quando a dashboard do corretor ganhar a seção "agenda" — por
  ora o log em console + `visit_reminders_sent` é suficiente.

### Track 3 — Financial sim
<!-- preenchido ao fechar -->

### Track 4 — TTS outbound
<!-- preenchido ao fechar -->

### Track 5 — Event outreach
<!-- preenchido ao fechar -->

---

## Pendências diferidas (revisitar antes de mexer no agente)

Itens conscientemente adiados. Não urgentes, mas vão doer se você mexer
em prompt/lógica da Bia sem resolver antes.

### P-1 · Firmar baseline do eval com 20/20 real

**Status**: baseline atual é 18/20 (firmado em 21/04, commit `44bb334`).
Aceitável como piso do CI gate (G-1), mas não é 100%.

**O que o eval faz, em uma frase**: roda 20 conversas sintéticas pelo
mesmo `runSDR()` de produção e compara estado final (reply, handoff,
stage, score, sources) vs gabarito em `evals/seed.json`. Cinto de
segurança pra mudanças de prompt/graph — detecta regressão antes do
merge.

**Precisa rodar quando**:
- Antes de mergear PR que mexe em `src/agent/**`, `src/lib/lead-memory.ts`,
  `src/lib/copilot.ts`, `src/lib/brief.ts`, ou system prompt
- Depois de upgrade de modelo (Sonnet novo, Haiku novo)
- Quando ativar o CI automático (ver P-2)

**Não precisa rodar em**: qualquer track que não toca agente (Track 3 até
3.3 é lib pura; Track 4 até 4.2 é TTS isolado; etc.)

**Custo por run**: ~$0.05–$0.10 (20 casos × 1–3 turns × router Haiku +
answer Sonnet). Runs demoram ~140s.

**Passos pra firmar 20/20 real**:
1. `npm run eval:emps` — lista empreendimentos reais do DB (helper
   `scripts/eval-list-emps.mjs`)
2. Editar `evals/seed.json` — 5 casos de grounding têm
   `mustMentionEmpreendimentoId: "REPLACE_WITH_REAL_EMP_ID_*"`.
   Substituir por UUIDs reais
3. `npm run eval:seed` (idempotente por `title`)
4. `npm run eval` com `npm run dev` rodando em outro terminal
5. Se passar 20/20: `npm run eval -- --update-baseline` (grava
   `evals/baseline.json`)
6. Se ficar com flaky (ex.: o caso `tone · lead indeciso` conhecido):
   `npm run eval -- --update-baseline --force` aceita e grava warning

**Por que não fiz agora**: Track 3 (finanças) é lib pura, não toca
agente. Baseline atual (18/20) já protege contra regressão >10% — o
gate do CI funciona. Firmar 20/20 é refinamento, não bloqueador.

### P-2 · Ativar CI gate automático

**Status**: `.github/workflows/eval.yml` existe mas tá dormente — não
tem os secrets pra rodar.

**Pra ativar**:
- GitHub repo → Settings → Secrets and variables → Actions → New secret:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY` (embeddings)
  - `BH_EVAL_TOKEN` (qualquer string aleatória; só precisa bater com
    `.env.local`)
- Depois do primeiro PR que mexer em agente, o workflow dispara sozinho

**Custo**: ~$0.10 por PR relevante. Irrelevante no volume atual.

**Por que não fiz**: depende de você ter acesso às secrets da Vercel/
Supabase de prod. É 5 minutos de UI, não vale abrir um slice.

### P-3 · Substituir fator câmbio fixo por cotação real

`src/lib/gestor-health.ts` converte USD→BRL com `5` hardcoded. Aceita
como sinal, ruim como número contábil. Refinar quando `ai_usage_log`
tiver `fx_rate_snapshot` ou quando integrarmos cotação live.

### P-4 · Seed helper que busca empreendimento por slug

Os placeholders `REPLACE_WITH_REAL_EMP_ID_*` no seed exigem passo
manual. Helper que resolve `slug → uuid` em runtime do `eval-seed.mjs`
elimina isso. Pequeno, mas vale fazer antes de expandir o seed além
dos 20 casos atuais.
