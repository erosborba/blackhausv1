-- =========================================================
-- Inbox & HITL (Human In The Loop):
--  - agent_notes: dicas ocultas que o corretor escreve para a Bia
--  - brief: último resumo gerado ao escalar a conversa
--  - Publica messages & leads no canal realtime
-- =========================================================

alter table public.leads
  add column if not exists agent_notes text,
  add column if not exists brief text,
  add column if not exists brief_at timestamptz;

-- Realtime publication: INSERT/UPDATE chegam no WebSocket do Supabase.
-- (Cria a publication se não existir, depois adiciona as tabelas
-- idempotentemente.)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.leads;
  exception when duplicate_object then null;
  end;
end $$;

-- RPC: lista unificada para o Inbox (lead + snippet da última mensagem).
-- Evita N+1 no cliente.
create or replace function public.inbox_items(search_text text default null)
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
  last_message_direction text
)
language sql stable as $$
  select
    l.id, l.phone, l.push_name, l.full_name,
    l.status, l.stage, l.qualification, l.agent_notes, l.human_takeover,
    l.last_message_at,
    m.content as last_message_content,
    m.direction as last_message_direction
  from public.leads l
  left join lateral (
    select content, direction
    from public.messages
    where lead_id = l.id
    order by created_at desc
    limit 1
  ) m on true
  where search_text is null or (
    l.phone ilike '%'||search_text||'%' or
    coalesce(l.push_name, '') ilike '%'||search_text||'%' or
    coalesce(l.full_name, '') ilike '%'||search_text||'%'
  )
  order by l.last_message_at desc nulls last
  limit 200;
$$;
