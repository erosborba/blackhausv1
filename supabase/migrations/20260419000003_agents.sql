-- Corretores (agentes humanos) + ponte lead↔corretor via WhatsApp.
--
-- Fluxo:
--  1. Bia detecta handoff → `initiateHandoff(leadId)` escolhe próximo corretor
--     no rodízio (`last_assigned_at NULLS FIRST ASC`), manda notificação,
--     marca `assigned_agent_id` e `handoff_notified_at`.
--  2. Timer de 5min: se `bridge_active=false` até lá, escala pro próximo.
--  3. Corretor responde a notificação (quote) ou usa `/lead <id>` → abre
--     ponte (`bridge_active=true`), Bia encaminha mensagens nos dois sentidos.
--  4. `/fim` fecha a ponte; lead continua em takeover até corretor retomar
--     a Bia pelo admin.

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,                 -- E.164 sem "+", ex: 5541997932996
  active boolean not null default true,
  telegram_chat_id text,                      -- backup pra notificação
  last_assigned_at timestamptz,               -- pra rodízio justo
  current_lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists agents_active_idx on public.agents (active, last_assigned_at nulls first);

alter table public.leads
  add column if not exists assigned_agent_id uuid references public.agents(id),
  add column if not exists bridge_active boolean not null default false,
  add column if not exists handoff_notified_at timestamptz,
  add column if not exists handoff_attempts int not null default 0;

create index if not exists leads_assigned_agent_idx on public.leads (assigned_agent_id);

-- Realtime pra admin ver ponte ao vivo.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'agents'
  ) then
    alter publication supabase_realtime add table public.agents;
  end if;
end $$;

-- Seed corretor inicial (Eros).
insert into public.agents (name, phone)
values ('Eros', '5541997932996')
on conflict (phone) do nothing;
