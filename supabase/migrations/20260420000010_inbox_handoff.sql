-- Exposição de handoff_reason/urgency no inbox_items (Tier 3 #2).
-- Continuação da migration 20260420000009 — apenas atualiza a RPC pra
-- devolver os novos campos, que o admin UI usa pra exibir o badge.
--
-- DROP obrigatório: mudamos a `returns table` (novas colunas), e o Postgres
-- não aceita `create or replace` quando o rowtype muda. Esse DROP é seguro
-- porque a RPC só é chamada via API do admin (sem schemas/views dependentes).

drop function if exists public.inbox_items(text);

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
  last_message_direction text,
  handoff_reason text,
  handoff_urgency text,
  handoff_notified_at timestamptz,
  bridge_active boolean
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
    l.bridge_active
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
