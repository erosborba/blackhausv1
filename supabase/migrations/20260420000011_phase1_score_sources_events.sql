-- Phase 1 — Inbox Cockpit
-- ========================================================================
-- 1) leads.score (0-100) + score_updated_at — calculado pelo router a cada
--    turno. Serve pro Priority Rail do /inbox (ordenação por urgência × fit).
--
-- 2) messages.sources (jsonb) — provenance do retrieval usado pra gerar a
--    mensagem outbound. Array de { kind, id, slug, nome, score }.
--    answerNode grava → UI mostra pill "📎 Empreendimento X" no bubble.
--
-- 3) lead_events — timeline de transições (status/stage/handoff/assignment)
--    e eventos arbitrários (draft_edited, memory_refreshed, factcheck_blocked).
--    Feed do painel de contexto no /inbox/[id].
--
-- 4) inbox_items RPC — re-expõe com os novos campos (score, score_updated_at).
--    DROP obrigatório: mudança de rowtype.
-- ========================================================================

-- ---------- 1. leads.score ----------
alter table public.leads
  add column if not exists score int not null default 0
    check (score between 0 and 100);

alter table public.leads
  add column if not exists score_updated_at timestamptz;

-- Priority rail ordena por score desc + last_message_at desc. Index composto
-- pra evitar sort em memória; `where status not in ('won','lost')` filtra o
-- grosso (descartamos ~60% dos leads mortos).
create index if not exists leads_priority_idx
  on public.leads (score desc, last_message_at desc nulls last)
  where status not in ('won', 'lost');

-- ---------- 2. messages.sources ----------
alter table public.messages
  add column if not exists sources jsonb;

-- Não indexamos sources (consumo sempre é por lead_id, join com messages).

-- ---------- 3. lead_events ----------
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null,
    -- status_change | stage_change | handoff_requested | handoff_resolved |
    -- assigned | bridge_opened | bridge_closed | draft_edited |
    -- memory_refreshed | factcheck_blocked | score_jump | note_added
  payload jsonb not null default '{}'::jsonb,
  actor text,
    -- 'system' | 'bia' | agent id | 'corretor:<id>'
  at timestamptz not null default now()
);

create index if not exists lead_events_lead_at_idx
  on public.lead_events (lead_id, at desc);

create index if not exists lead_events_kind_idx
  on public.lead_events (kind, at desc);

-- Timeline RPC: últimos N eventos do lead, mais recentes primeiro.
-- Uso: /api/leads/[id]/timeline.
create or replace function public.lead_timeline(p_lead_id uuid, p_limit int default 50)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  actor text,
  at timestamptz
)
language sql stable as $$
  select id, kind, payload, actor, at
  from public.lead_events
  where lead_id = p_lead_id
  order by at desc
  limit greatest(1, least(p_limit, 200));
$$;

-- ---------- 4. inbox_items — adiciona score + score_updated_at ----------
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
  bridge_active boolean,
  score int,
  score_updated_at timestamptz
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
    l.score_updated_at
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
  order by
    -- Priorização: score desc + recência desc. Urgency entra via CASE
    -- (alta > media > baixa) pra leads em handoff pendente subirem.
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

-- Realtime: garantir que lead_events também é publicado pro client consumir
-- timeline ao vivo. messages + leads já estavam (migration 20260419000002).
alter publication supabase_realtime add table public.lead_events;
