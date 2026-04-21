-- Phase 3 — Empreendimentos + Pipeline + Agenda
-- ========================================================================
-- Duas tabelas novas + RPCs pra suportar:
--   - unidades (matriz por andar + availability real)
--   - visits (agendamentos lead↔corretor↔empreendimento)
--
-- Os agent tools (check_availability, schedule_visit) dependem de unidades.
-- O /pipeline kanban lê direto leads.stage (já existe) com RPC pra contagem.
-- O /agenda consome follow_ups (já existe) + visits (nova).
--
-- Nota: `agents` já existe (migration 20260419000003, shape phone-based).
-- Aqui só aditivamente colocamos `email` + `role` pra Phase 5 não ter que
-- mexer em FK existente. Ambos nullable/optional pra não quebrar o seed.
-- ========================================================================

-- ---------- agents (aditivo) ----------
alter table public.agents
  add column if not exists email text,
  add column if not exists role text not null default 'corretor';

-- Unique parcial — só emails não-null, evita colisão com seeds antigos sem email.
create unique index if not exists agents_email_unique_idx
  on public.agents(email) where email is not null;

-- Check em separado pra ser idempotente (se já existir, ignora).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_role_check'
  ) then
    alter table public.agents
      add constraint agents_role_check check (role in ('admin', 'corretor'));
  end if;
end $$;

-- ---------- unidades ----------
-- Uma linha por unidade física. `status` é o coração: availability.
-- Tipologia_ref é texto livre (ex: "2q-vista-mar") pra mapear no JSONB
-- empreendimentos.tipologias — fica frouxo pra não forçar normalização
-- antes da hora.
create table if not exists public.unidades (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  andar int not null,
  numero text not null,
    -- "101", "204B", "Cobertura 3" — texto livre.
  tipologia_ref text,
    -- Chave pra juntar com empreendimentos.tipologias (ex: "2q-suite").
  preco numeric,
  status text not null default 'avail'
    check (status in ('avail', 'reserved', 'sold', 'unavailable')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unicidade: (empreendimento, andar, numero) — não deve repetir.
create unique index if not exists unidades_unique_idx
  on public.unidades (empreendimento_id, andar, numero);

create index if not exists unidades_empreendimento_status_idx
  on public.unidades (empreendimento_id, status);

create index if not exists unidades_tipologia_idx
  on public.unidades (empreendimento_id, tipologia_ref)
  where tipologia_ref is not null;

-- updated_at auto (reusa função do init_sdr).
drop trigger if exists unidades_touch_updated_at on public.unidades;
create trigger unidades_touch_updated_at
  before update on public.unidades
  for each row execute function public.touch_updated_at();

-- RPC: matriz por andar. Usado no /empreendimentos/[id] aba Unidades.
-- Retorna agrupado por andar com array de {numero, status, preco, tipologia_ref}.
create or replace function public.unidades_matrix(p_empreendimento_id uuid)
returns table (
  andar int,
  unidades jsonb
)
language sql stable as $$
  select
    andar,
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'numero', numero,
        'status', status,
        'preco', preco,
        'tipologia_ref', tipologia_ref,
        'notes', notes
      ) order by numero
    ) as unidades
  from public.unidades
  where empreendimento_id = p_empreendimento_id
  group by andar
  order by andar desc;
$$;

-- RPC: availability summary por empreendimento — contagem por status.
-- Consumido por agent tool `check_availability` + card no detail view.
create or replace function public.unidades_summary(p_empreendimento_id uuid)
returns table (
  total bigint,
  avail bigint,
  reserved bigint,
  sold bigint,
  unavailable bigint,
  min_preco numeric,
  max_preco numeric
)
language sql stable as $$
  select
    count(*)::bigint as total,
    count(*) filter (where status = 'avail')::bigint,
    count(*) filter (where status = 'reserved')::bigint,
    count(*) filter (where status = 'sold')::bigint,
    count(*) filter (where status = 'unavailable')::bigint,
    min(preco) filter (where status = 'avail'),
    max(preco) filter (where status = 'avail')
  from public.unidades
  where empreendimento_id = p_empreendimento_id;
$$;

-- ---------- visits ----------
-- Agendamentos. Um lead pode ter várias visits (remarcações, múltiplos
-- empreendimentos). Status transita linearmente:
--   scheduled → confirmed → done    (happy path)
--   scheduled → cancelled           (cancelou)
--   scheduled → no_show             (faltou — ruim pra funil)
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  unidade_id uuid references public.unidades(id) on delete set null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show')),
  notes text,
  created_by text,
    -- 'bia' | 'corretor:<id>' | 'lead'
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visits_lead_idx on public.visits(lead_id, scheduled_at desc);
create index if not exists visits_agent_date_idx on public.visits(agent_id, scheduled_at);
create index if not exists visits_date_idx on public.visits(scheduled_at);
create index if not exists visits_status_idx on public.visits(status, scheduled_at);

drop trigger if exists visits_touch_updated_at on public.visits;
create trigger visits_touch_updated_at
  before update on public.visits
  for each row execute function public.touch_updated_at();

-- RPC: visits do dia (hoje ou custom) pro /agenda.
create or replace function public.visits_between(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  empreendimento_id uuid,
  empreendimento_nome text,
  agent_id uuid,
  scheduled_at timestamptz,
  status text,
  notes text
)
language sql stable as $$
  select
    v.id,
    v.lead_id,
    coalesce(l.full_name, l.push_name, l.phone) as lead_name,
    l.phone as lead_phone,
    v.empreendimento_id,
    e.nome as empreendimento_nome,
    v.agent_id,
    v.scheduled_at,
    v.status,
    v.notes
  from public.visits v
  join public.leads l on l.id = v.lead_id
  left join public.empreendimentos e on e.id = v.empreendimento_id
  where v.scheduled_at >= p_from and v.scheduled_at < p_to
  order by v.scheduled_at;
$$;

-- ---------- Pipeline RPC ----------
-- Contagem de leads por stage pro kanban. Filtra status terminais
-- (won/lost) — eles aparecem numa coluna "Concluídos" à parte.
create or replace function public.pipeline_counts()
returns table (
  stage text,
  count bigint
)
language sql stable as $$
  select coalesce(stage, '—') as stage, count(*)::bigint
  from public.leads
  where status not in ('won', 'lost')
  group by stage
  order by count desc;
$$;

-- Leads por stage (paginado, usado quando a coluna expande).
create or replace function public.pipeline_leads(p_stage text, p_limit int default 50)
returns table (
  id uuid,
  phone text,
  name text,
  score int,
  status text,
  last_message_at timestamptz,
  handoff_notified_at timestamptz
)
language sql stable as $$
  select
    l.id,
    l.phone,
    coalesce(l.full_name, l.push_name, l.phone) as name,
    coalesce(l.score, 0) as score,
    l.status,
    l.last_message_at,
    l.handoff_notified_at
  from public.leads l
  where l.status not in ('won', 'lost')
    and coalesce(l.stage, '—') = coalesce(p_stage, '—')
  order by l.score desc, l.last_message_at desc nulls last
  limit greatest(1, least(p_limit, 200));
$$;

-- Realtime: UI do pipeline/agenda atualiza ao vivo.
alter publication supabase_realtime add table public.unidades;
alter publication supabase_realtime add table public.visits;
