-- Registro de drafts que a Bia propõe no modo copiloto, pra medir
-- taxa de aprovação por nível de confiança antes de liberar auto-send.
--
-- Fluxo:
--  1. Bia chama propor_resposta → insert com action='proposed'.
--  2. Corretor faz quote do draft e responde 👍 → update action='approved',
--     final_text = proposed_text, acted_at = now().
--  3. Corretor faz quote e responde com edição → action='edited',
--     final_text = texto editado.
--  4. Corretor ignora → cron periódico marca action='ignored' depois de X horas
--     (não implementado nesta migration; query manual enquanto isso).
--
-- Métricas que essa tabela habilita:
--  • % aprovação por confidence (alta/media/baixa)
--  • tempo mediano entre 'proposed' e acted_at
--  • similaridade entre proposed_text e final_text (via SQL simples ou offline)
--  • drafts por dia / por corretor

create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  proposed_text text not null,
  confidence text not null check (confidence in ('alta', 'media', 'baixa')),
  action text not null default 'proposed'
    check (action in ('proposed', 'approved', 'edited', 'ignored')),
  final_text text,
  created_at timestamptz not null default now(),
  acted_at timestamptz
);

-- Pra achar rapidamente o último 'proposed' quando o corretor faz quote+👍.
create index if not exists drafts_lookup_idx
  on public.drafts (lead_id, agent_id, created_at desc)
  where action = 'proposed';

-- Pra agregações de métricas (group by confidence, action).
create index if not exists drafts_confidence_action_idx
  on public.drafts (confidence, action);

-- Realtime pra um futuro painel ao vivo no admin.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'drafts'
  ) then
    alter publication supabase_realtime add table public.drafts;
  end if;
end $$;
