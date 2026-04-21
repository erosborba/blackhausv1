-- Phase 5 — Corretor profile hardening (auth)
-- ========================================================================
-- Amarra `agents` em `auth.users` pra habilitar magic-link login.
-- Estratégia:
--   1. Adiciona agents.user_id (nullable, FK em auth.users).
--   2. Trigger on INSERT em auth.users: se email casar com agents.email
--      (case-insensitive), popula agents.user_id automaticamente.
--   3. Função helper public.current_agent() que retorna a row de agents
--      do auth.uid() atual — usada no SSR client pra resolver role.
--
-- O fluxo esperado:
--   - Admin cadastra agent com email preenchido (via /ajustes).
--   - Agent recebe magic-link em `/login`.
--   - Ao clicar, Supabase cria auth.users; trigger amarra em agents.
--   - SSR client lê session → current_agent() → {role, id, name}.
-- ========================================================================

-- ---------- agents: colunas que faltavam ----------
-- `user_id` pra auth link + `updated_at` (não existia desde 20260419000003).
-- Backfill updated_at = created_at pros existentes — evita NULLs.
alter table public.agents
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.agents
   set updated_at = created_at
 where updated_at is null;

create unique index if not exists agents_user_id_unique_idx
  on public.agents(user_id) where user_id is not null;

-- Trigger de touch_updated_at — aplica se ainda não existir.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'agents_touch_updated_at'
       and tgrelid = 'public.agents'::regclass
  ) then
    create trigger agents_touch_updated_at
      before update on public.agents
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- ---------- auto-link trigger ----------
-- Quando um auth.users é criado, procura agents por email (ci) e amarra.
-- SECURITY DEFINER porque roda no schema auth (trigger owner = postgres).
create or replace function public.link_agent_on_user_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agents
     set user_id = new.id,
         updated_at = now()
   where user_id is null
     and email is not null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_agent on auth.users;
create trigger on_auth_user_created_link_agent
  after insert on auth.users
  for each row execute function public.link_agent_on_user_signup();

-- Backfill pra auth.users já existentes (idempotente — só pega os nulls).
update public.agents a
   set user_id = u.id,
       updated_at = now()
  from auth.users u
 where a.user_id is null
   and a.email is not null
   and lower(a.email) = lower(u.email);

-- ---------- current_agent() helper ----------
-- Usado via RPC do SSR client. Retorna zero-ou-uma linha pra evitar
-- 500 quando o user logado não está mapeado.
create or replace function public.current_agent()
returns table (
  id uuid,
  name text,
  email text,
  phone text,
  role text,
  active boolean
)
language sql stable
security definer
set search_path = public
as $$
  select a.id, a.name, a.email, a.phone, a.role, a.active
    from public.agents a
   where a.user_id = auth.uid()
   limit 1;
$$;

-- Grant pra anon+authenticated chamarem via RPC.
grant execute on function public.current_agent() to anon, authenticated;

-- ---------- inbox_items: expõe assigned_agent_id + filtro opcional ----------
-- Corretor só vê os leads atribuídos a ele. Admin passa null → sem filtro.
-- DROP obrigatório pois rowtype mudou (novo campo).
drop function if exists public.inbox_items(text);
drop function if exists public.inbox_items(text, uuid);

create or replace function public.inbox_items(
  search_text text default null,
  p_agent_id uuid default null
)
returns table (
  id uuid,
  phone text,
  push_name text,
  full_name text,
  status text,
  stage text,
  qualification jsonb,
  agent_notes text,
  human_takeover boolean,
  last_message_at timestamptz,
  last_message_content text,
  last_message_direction text,
  handoff_reason text,
  handoff_urgency text,
  handoff_notified_at timestamptz,
  bridge_active boolean,
  score int,
  score_updated_at timestamptz,
  assigned_agent_id uuid
)
language sql stable as $$
  select
    l.id, l.phone, l.push_name, l.full_name,
    l.status, l.stage, l.qualification, l.agent_notes, l.human_takeover,
    l.last_message_at,
    m.content as last_message_content,
    m.direction as last_message_direction,
    l.handoff_reason,
    l.handoff_urgency,
    l.handoff_notified_at,
    l.bridge_active,
    l.score,
    l.score_updated_at,
    l.assigned_agent_id
  from public.leads l
  left join lateral (
    select content, direction
    from public.messages
    where lead_id = l.id
    order by created_at desc
    limit 1
  ) m on true
  where (search_text is null or (
    l.phone ilike '%'||search_text||'%' or
    coalesce(l.push_name, '') ilike '%'||search_text||'%' or
    coalesce(l.full_name, '') ilike '%'||search_text||'%'
  ))
  and (p_agent_id is null or l.assigned_agent_id = p_agent_id)
  order by
    case l.handoff_urgency
      when 'alta' then 3
      when 'media' then 2
      when 'baixa' then 1
      else 0
    end desc,
    l.score desc,
    l.last_message_at desc nulls last
  limit 200;
$$;
