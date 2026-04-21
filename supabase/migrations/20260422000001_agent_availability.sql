-- Track 2 · Slice 2.1 — Agent availability + visit reminders dedupe
--
-- Uma janela semanal por corretor (weekday + horas). Usado pelo
-- `src/lib/slot-allocator.ts` pra gerar slots propostos no tool
-- `propose_visit_slots` (Slice 2.4) e respeitado por `book_visit v2`
-- (Slice 2.5) pra anti-double-book.
--
-- `visit_reminders_sent` é a tabela de idempotência do cron de
-- lembretes (Slice 2.6): se a linha (visit_id, kind) existe, não
-- re-envia.
--
-- Invariants: I-2 (sem custo/tráfego fantasma), I-7 (audit via
-- lead_events pra cada agendamento).

-- ---------- agent_availability ----------
create table if not exists public.agent_availability (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
    -- 0 = domingo, 6 = sábado (padrão Date.getDay JS/Postgres).
  start_minute smallint not null check (start_minute between 0 and 1439),
    -- Minutos desde 00:00 no timezone. Ex: 540 = 09:00.
  end_minute smallint not null check (end_minute between 1 and 1440),
    -- Minutos exclusivos. Ex: 1080 = 18:00.
  timezone text not null default 'America/Sao_Paulo',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_minute < end_minute)
);

-- Evita janelas duplicadas idênticas (mesmo corretor, mesmo dia, mesmo horário).
create unique index if not exists agent_availability_unique_idx
  on public.agent_availability (agent_id, weekday, start_minute, end_minute)
  where active = true;

create index if not exists agent_availability_agent_idx
  on public.agent_availability (agent_id)
  where active = true;

drop trigger if exists agent_availability_touch_updated_at on public.agent_availability;
create trigger agent_availability_touch_updated_at
  before update on public.agent_availability
  for each row execute function public.touch_updated_at();

comment on table public.agent_availability is
  'Janelas semanais recorrentes de disponibilidade por corretor. Slot allocator gera slots livres daqui + desconta visits agendadas.';

-- ---------- visit_reminders_sent ----------
create table if not exists public.visit_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  kind text not null check (kind in ('24h', '2h', 'post_visit')),
  sent_at timestamptz not null default now(),
  message_id uuid,
    -- FK flexível pro messages.id (pode ser null se envio falhou mas tentamos).
  ok boolean not null default true,
  error text,
  unique (visit_id, kind)
);

create index if not exists visit_reminders_visit_idx
  on public.visit_reminders_sent (visit_id, kind);

create index if not exists visit_reminders_kind_time_idx
  on public.visit_reminders_sent (kind, sent_at desc);

comment on table public.visit_reminders_sent is
  'Idempotência dos lembretes pré/pós-visita. Cron só envia se (visit_id, kind) não existe.';

-- ---------- Seed opcional: expõe via RPC os corretores ativos sem availability ----------
-- Usado pra flag no painel /ajustes/corretor avisando que a janela não
-- foi configurada (corretor sem availability = slot allocator devolve []).
create or replace function public.agents_without_availability()
returns table (id uuid, name text, email text)
language sql stable as $$
  select a.id, a.name, a.email
  from public.agents a
  where a.active = true
    and not exists (
      select 1 from public.agent_availability av
      where av.agent_id = a.id and av.active = true
    );
$$;

-- Realtime: UI /ajustes/agenda reflete edições ao vivo. `alter publication`
-- não tem `if not exists`, então conditional via pg_publication_tables.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agent_availability'
  ) then
    alter publication supabase_realtime add table public.agent_availability;
  end if;
end $$;
