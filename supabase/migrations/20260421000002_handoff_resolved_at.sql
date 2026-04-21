-- Phase 5+ — Handoff resolved timestamp
-- ========================================================================
-- Problema: a UI deriva "handoff pendente" de `handoff_notified_at != null
-- && !bridge_active`. Depois que o corretor avalia o handoff (POST
-- /api/handoff/[leadId]) o sinal de "pendente" não some, porque não temos
-- coluna que marque "já foi revisado". Nullar `handoff_notified_at` quebraria
-- as stats históricas (gestor-stats conta handoffs por dia). Solução limpa:
-- nova coluna `handoff_resolved_at`. Quem for "pendente" agora precisa de:
--    handoff_notified_at != null AND NOT bridge_active AND handoff_resolved_at IS NULL
--
-- Novo handoff (initiateHandoff) deve resetar esta coluna pra null — se o
-- lead voltar a quente depois, o corretor re-revisar a nova escalação.
-- ========================================================================

alter table public.leads
  add column if not exists handoff_resolved_at timestamptz;

-- Re-expõe inbox_items RPC com o novo campo. DROP obrigatório pois o
-- rowtype mudou.
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
  handoff_resolved_at timestamptz,
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
    l.handoff_resolved_at,
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
