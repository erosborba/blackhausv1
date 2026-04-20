-- Fatia F: telemetria de uso AI (Claude + OpenAI).
--
-- Toda chamada a LLM/embedding registra uma linha aqui. Serve pra:
--   1. Dashboard /admin/usage: quanto está gastando por task, por modelo, por dia.
--   2. Debug: correlacionar pico de custo com empreendimento_id ou lead_id.
--   3. Alerta futuro: cron pode olhar a tabela e disparar webhook se ultrapassar orçamento.
--
-- Custo já vem calculado (cost_usd) pra não depender de join com tabela de pricing
-- na hora do dashboard. Se o preço mudar no futuro, linhas antigas ficam com o preço
-- da época — exatamente o que a gente quer pra histórico.
--
-- Não usamos FK forte em lead_id: lead pode ser deletado e a gente quer manter
-- o registro de custo mesmo assim. Pra empreendimento_id usamos SET NULL pelo
-- mesmo motivo.

create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- provedor + modelo: 'anthropic' / 'openai' + string exata do modelo
  provider text not null check (provider in ('anthropic', 'openai')),
  model text not null,

  -- task enum em string livre; validação no app. Facilita adicionar sem migrar:
  --   'extract' | 'faq_suggest' | 'copilot' | 'brief'
  --   'bia_router' | 'bia_answer'
  --   'rag_embed_chunks' | 'rag_embed_query'
  task text not null,

  -- contadores brutos vindos da API
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,    -- só Anthropic (prompt caching hit)
  cache_write_tokens int not null default 0,   -- só Anthropic (prompt caching miss/write)

  -- custo já convertido em USD usando a pricing table do app (src/lib/ai-usage.ts)
  cost_usd numeric(10, 6) not null default 0,

  -- tempo de parede da chamada (pra spot latência alta correlacionada com custo)
  duration_ms int not null default 0,

  -- correlação opcional com entidades do domínio
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  lead_id uuid,

  -- resultado + metadata livre (ex.: prompt_hash, model_version, request_id)
  ok boolean not null default true,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

-- Índices pensados pros filtros do dashboard:
--   "quanto gastei nos últimos 7 dias" → por created_at
--   "qual task mais cara no mês" → (task, created_at)
--   "qual empreendimento puxou mais token essa semana" → (empreendimento_id, created_at)
create index if not exists ai_usage_log_created_at_idx
  on public.ai_usage_log (created_at desc);

create index if not exists ai_usage_log_task_created_at_idx
  on public.ai_usage_log (task, created_at desc);

create index if not exists ai_usage_log_emp_created_at_idx
  on public.ai_usage_log (empreendimento_id, created_at desc)
  where empreendimento_id is not null;
