-- Track 2 · Slice 2.3' — Bloqueios pontuais de corretor
--
-- Complementa `agent_availability` (janelas recorrentes positivas) com
-- uma lista de bloqueios one-off: férias, consulta médica, reunião
-- externa, etc. O slot-allocator trata essas rows como busy com
-- duration_min explícito (via BusyVisit.duration_min).
--
-- Por que não meter isso em agent_availability com flag "bloqueio"?
-- Porque conceitualmente availability é POSITIVO (quando está aberto)
-- e unavailability é NEGATIVO (quando está fechado apesar da janela).
-- Misturar vira escadaria de CASE. Duas tabelas, uma regra simples:
-- slot livre = janela ativa ∩ NÃO(visit agendada) ∩ NÃO(bloqueio).
--
-- Substitui parcialmente o que Google Calendar daria (ler blocos
-- externos) — o corretor registra manualmente aqui, a Bia respeita.

create table if not exists public.agent_unavailability (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
    -- Free-form: "férias", "consulta", "reunião externa", "folga".
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
    -- "admin" | "corretor:<id>" | "bia" (improvável mas possível)
  check (end_at > start_at)
);

create index if not exists agent_unavail_agent_time_idx
  on public.agent_unavailability (agent_id, start_at, end_at)
  where active = true;

create index if not exists agent_unavail_window_idx
  on public.agent_unavailability (start_at)
  where active = true;

comment on table public.agent_unavailability is
  'Bloqueios pontuais de corretor (férias, consulta, folga). Slot allocator desconta esses intervalos alem das visits já marcadas.';

-- Realtime pra UI refletir edições.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agent_unavailability'
  ) then
    alter publication supabase_realtime add table public.agent_unavailability;
  end if;
end $$;
