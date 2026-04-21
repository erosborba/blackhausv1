# Débitos técnicos + roadmap pendente

Última atualização: 2026-04-20

Documento vivo. Quando resolver um item, marque `[x]` e deixe a data.
Quando adicionar novo débito, inclua file:linha pra ficar rastreável.

---

## 1. Débitos técnicos (coisas que funcionam mas precisam evoluir)

### 🔴 Alta — destravar antes de abrir pra mais corretores

- [ ] **Admin sem auth.** Rotas `/admin/*` e `/api/admin/*` são abertas —
  "quem chega, opera". Hoje é só você, mas qualquer link vazado expõe inbox,
  settings, empreendimentos e até o botão de cleanup.
  Arquivos: `src/app/api/admin/cleanup/route.ts:14`, todas as rotas em
  `src/app/admin/**`.
  **Solução**: Supabase Auth (magic link) + middleware que valida sessão em
  `/admin/*`; allowlist de e-mails em `system_settings`. Mesmo cookie pode
  autorizar as API routes.

- [ ] **CRON_SECRET opcional.** Se a env não estiver setada, cron aceita sem
  auth. Bom pra dev, arriscado em prod — qualquer curl dispara limpeza,
  follow-up scan, handoff escalation.
  Arquivo: `src/app/api/cron/cleanup/route.ts:19` (e irmãos em
  `src/app/api/cron/*`).
  **Solução**: fail-closed em prod (`if (!secret && NODE_ENV === "production")
  return 500`).

- [ ] **Webhook Evolution sem rate limit.** Endpoint `/api/webhook/evolution`
  processa qualquer POST. Em caso de loop ou ataque, paga Claude/Whisper
  enquanto não cai.
  Arquivo: `src/app/api/webhook/evolution/route.ts`.
  **Solução**: idempotência por `messageId` (já existe via UNIQUE constraint em
  `messages.evolution_message_id`) + leaky bucket por `remoteJid` via
  Postgres/Redis. Abortar cedo se > N msgs/min.

- [ ] **Sem testes.** Zero cobertura (nem unit, nem eval, nem e2e). Cada
  refactor é "espera o webhook real reclamar". `npx tsc` é todo o CI.
  **Solução**: começar com 5 smoke evals do agente (router classificando
  greet/discover/handoff em fixtures), rodados em CI. Depois seeds por
  cenário pro admin. Vitest já é ergonômico com Next.

### 🟡 Média — vai incomodar em breve

- [ ] **Debounce in-memory.** `src/lib/debounce.ts` segura timers num `Map`
  global. Funciona porque Railway roda um único processo Node; se migrar pra
  serverless (Vercel Functions) ou escalar horizontalmente, mensagens
  concatenadas viram fragmentos perdidos.
  **Solução**: mover buffer pra Redis (zset com TTL) ou pra Postgres
  (`inbound_buffer` table + scheduled flush via cron curto).

- [ ] **Checkpointer duplicando HumanMessages.** `messagesStateReducer` anexa
  por ID; a cada invocação do grafo, `runSDR` monta `HumanMessage`s novos (IDs
  auto) a partir de `recentMessages`, então o checkpointer acumula
  duplicatas. Visível como inflação em `langgraph_checkpoints`.
  Arquivo: `src/agent/nodes.ts:41` (comentário descrevendo o débito),
  `src/agent/graph.ts:65` (re-hidratação).
  **Solução**: (a) hidratar com IDs determinísticos (`hash(leadId + messageId)`),
  ou (b) migrar pra `RemoveMessage` quando compactação rodar, ou (c) parar de
  re-hidratar e confiar 100% no checkpointer — vale benchmark antes.

- [ ] **Funnel approximation.** `/admin/funnel` agrega em memória, cap 2000
  leads + 20k mensagens por janela. Conversão sequencial assume que um lead
  "lost" nunca foi "qualified" (não temos event sourcing).
  Arquivo: `src/app/admin/funnel/page.tsx:20,114,500`.
  **Solução 1 (tática)**: RPC materializada refresh diário. **Solução 2
  (estratégica)**: tabela `lead_events` com INSERT em cada transição de status
  — habilita funil exato e coortes.

- [ ] **Sem observabilidade além do `ai_usage_log`.** Custo Claude/OpenAI é
  rastreado; erros de runtime viram `console.error` e morrem no stdout do
  Railway. Sem alerting, sem tracing de grafo, sem uptime check.
  **Solução**: Sentry (gratuito até 5k events/mês) pra erros; opcional
  LangSmith pra tracing do grafo (mas vem com vendor lock). Uptime via
  `/api/health` ping de um UptimeRobot free.

- [ ] **Admin UI com inline styles.** Todas as páginas `/admin/*` usam
  `CSSProperties` inline. Funcionou pra ship rápido, mas não tem dark/light
  toggle, tokens compartilhados nem reuso — badge e chip foram copiados 4+
  vezes.
  **Solução**: extrair design tokens (cores, spacing, radius) pra um `theme.ts`
  e criar `<Chip>`, `<Badge>`, `<Card>` como components. Tailwind é overkill
  pro tamanho — CSS modules basta.

- [ ] **Vídeo não consumido.** Bia responde "recebi seu vídeo mas ainda não
  consigo assistir" e segue. Áudio e imagem já são multimodais.
  Arquivo: `src/app/api/webhook/evolution/route.ts:736`.
  **Solução**: Gemini/Claude vision de primeiro frame + transcrição de áudio
  do vídeo (ffmpeg → Whisper). Só vale depois que o volume justificar —
  por enquanto é <5% das mensagens.

### 🟢 Baixa — anotar e não esquecer

- [ ] **Copy canônica de handoff duplicada em 3 lugares.** `HANDOFF_REASON_LABEL`
  e `URGENCY_EMOJI` estão em `state.ts` (server), `inbox-client.tsx` e
  `[id]/thread-client.tsx` (client), além do funnel. Cada um tem seu próprio
  objeto porque `state.ts` arrasta dependências de lib server-only.
  **Solução**: extrair pra `src/lib/handoff-copy.ts` puro (sem imports de
  DB/LLM), importar de ambos os lados.

- [ ] **`@ts-expect-error` em empreendimentos-extract.** Document block no
  SDK Anthropic ainda não está tipado.
  Arquivo: `src/lib/empreendimentos-extract.ts:207`.
  **Solução**: remover quando `@anthropic-ai/sdk` atualizar (hoje 0.40.0).

- [ ] **`memory` pode crescer sem bound.** `lead_memory` é um texto livre que
  o Haiku mantém em background. Não tem size limit nem TTL.
  **Solução**: cap em ~4KB e incluir instrução no prompt de manutenção pra
  sumarizar se estourar.

- [ ] **Draft learnings sem cleanup.** `getRecentDraftEdits` lê últimos N
  edits pra alimentar prompt — não roda GC.
  **Solução**: drop de rows > 90 dias no `runAllCleanup`.

- [ ] **Retrieval threshold hardcoded.** `RAG_STRONG_THRESHOLD_DEFAULT = 0.55`
  em `nodes.ts`. Já é override-able por settings, mas não há UI.
  **Solução**: expor em `/admin/configuracoes` quando alguém precisar tunar.

---

## 2. Roadmap pendente

Tier 1 (MVP agente) e Tier 2 (eficiência + observabilidade) fechados.
Tier 3 é qualidade de conversa — itens abaixo em ordem tentativa de prioridade:

### Tier 3 — em aberto

- [ ] **#1 Feedback loop do corretor.** Hoje o corretor recebe notificação e
  some do sistema. Nada sinaliza se o lead era bom/ruim, se a Bia qualificou
  direito, se o motivo estava certo.
  **Entrega**: no link da notificação (`/admin/leads/[id]`) adicionar botões
  "foi bom handoff / foi cedo / foi tarde / lead ruim". Guardar em
  `handoff_feedback` (leadId, score enum, note, at). Alimenta dois loops:
  (a) métrica "acurácia de handoff" no funnel; (b) few-shots pro router
  (leads marcados "cedo" viram exemplos negativos).
  **Custo**: 1 migration + 1 route + UI no thread-client. ~4h.

- [ ] **#3 Re-engagement adaptativo.** Follow-up já existe (`follow_ups` +
  cron), mas é regra fixa (N horas de silêncio → mensagem). Não usa
  qualificação, não ajusta timing por urgência.
  **Entrega**: `follow_up_policy` por estágio — em `discover`, follow-up em
  24h é ok; em `recommend` esperando visita, 6h é crítico. E tom da mensagem
  muda (Haiku gera a partir de contexto + urgência).
  **Custo**: novo setting por stage + reformular `follow-ups.ts`. ~6h.

- [ ] **#4 Ferramentas reais do agente.** Hoje Bia "agenda" mentindo uma
  disponibilidade — não consulta agenda real do corretor, não cria evento.
  Quando o lead pergunta "qual a melhor tipologia pra família de 4?", ela
  responde da memória do RAG, sem cross-check com unidades disponíveis.
  **Entrega (fase 1)**: tool `check_availability(empreendimento_id, tipo)`
  que lê `empreendimentos.unidades_disponiveis`. Tool `schedule_visit(lead,
  date)` que grava em `visits` e notifica corretor.
  **Entrega (fase 2)**: Google Calendar OAuth por corretor → disponibilidade
  real.
  **Custo**: fase 1 ~8h, fase 2 ~16h + OAuth setup.

- [ ] **#5 Evals automáticos.** Esperar até ter ~200 conversas reais pra
  extrair fixtures. Hoje não tem massa.
  **Entrega**: `evals/` com datasets YAML (input + expected intent/stage/
  qualification). Script CLI roda grafo em cada fixture e diffa saída. CI
  roda em PR.
  **Custo**: infra ~4h, primeiros 20 fixtures ~2h.

### Além-tier — quando escalar

- [ ] **Multi-tenant.** Hoje é single-tenant implícito (uma imobiliária,
  um corretor, uma Bia). Quando entrar o segundo cliente, precisa de
  `tenant_id` em leads/messages/empreendimentos/settings + RLS por tenant.

- [ ] **Runtime split server/client.** Alguns libs (`state.ts`) são
  forçadas a ser server-only por arrastar SDK. Isso empurra duplicação (ver
  débito 🟢 acima). Resolver depois de estabilizar a taxonomia.

- [ ] **i18n.** Todas as strings em pt-BR inline. Uma segunda imobiliária
  em outra língua força extração.

- [ ] **Webhook retry / DLQ.** Se o grafo lança e o webhook 500a, Evolution
  re-envia mas sem backoff inteligente. Uma queue (pg-boss ou bullmq) deixa
  retry com backoff + DLQ visível no admin.

---

## 3. Notas de arquitetura (contexto pra futuro refactor)

- **Checkpointer Postgres**: `langgraph-checkpoint-postgres` persiste todo o
  state do grafo por `thread_id = "lead:<uuid>"`. É a fonte de continuidade
  entre turnos. Se resetar, Bia "esquece" o fio da conversa — mas a `memory`
  do lead e o histórico em `messages` sobrevivem.

- **Debounce → run**: toda inbound entra no `scheduleInbound`, que junta N
  mensagens em 4s de silêncio antes de chamar `runSDR`. Economiza ~30% das
  chamadas LLM em leads que digitam fragmentado.

- **Compact → router → retrieve? → answer | handoff**: o grafo é linear com
  um fork em `router`. Retrieve só roda se intent === "answer" e a pergunta
  parece factual; handoff termina o turno sem gerar reply do agente (o corretor
  humano assume).

- **Factcheck é post-hoc**: roda DEPOIS do `answer` gerar, não antes. Se achar
  claim sem respaldo no RAG, substitui por mensagem evasiva + aciona handoff
  com `ia_incerta`. Custo médio: 1 Haiku extra por turno em que há retrieval.

- **ai_usage_log**: toda chamada LLM/Whisper passa por `logUsage()`. Base pra
  `/admin/usage` e pra billing futuro. Campo `task` enum (router, answer,
  factcheck, compact, memory, followup, vision, transcribe, brief) é o eixo
  principal.
