-- Track 1 · Slice 1.1 · Eval harness infrastructure
--
-- Cada linha é uma conversa (1 ou mais turnos do lead) com o estado final
-- esperado depois que a Bia processa todos os turnos. Runner replica os
-- turnos via runSDR() e compara o estado final vs `expected`.
--
-- Invariants tocados: I-4 (evaluation-first), I-6 (determinismo).

create table if not exists public.eval_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Sequência de inputs do lead, em ordem cronológica.
  -- Forma: [{"content": "oi, tudo bem?", "media_type": null}, ...]
  lead_messages jsonb not null default '[]'::jsonb,
  -- Estado inicial do lead sintético (qualification, stage, score, memory…)
  initial_lead jsonb not null default '{}'::jsonb,
  -- Expectativas sobre o estado final. Campos opcionais:
  --   needsHandoff: bool
  --   handoffReason: text
  --   stage: text
  --   scoreMin / scoreMax: int
  --   qualificationKeys: text[] (chaves que devem existir em qualification)
  --   mustMentionEmpreendimentoId: uuid (retrieval deve citar esse empreendimento)
  expected jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eval_conversations_tags_idx
  on public.eval_conversations using gin (tags);

create index if not exists eval_conversations_created_at_idx
  on public.eval_conversations (created_at desc);

-- RLS: apenas server-side (service role). UI de eval fica no /gestor.
alter table public.eval_conversations enable row level security;

drop policy if exists eval_conversations_service_all on public.eval_conversations;
create policy eval_conversations_service_all
  on public.eval_conversations
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.eval_conversations is
  'Eval set da Bia — cada row é uma conversa determinística usada pelo runner em scripts/eval-run.mjs. Veja docs/VANGUARD_SLICES.md#1.1.';
