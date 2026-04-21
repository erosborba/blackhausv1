-- Track 1 · Slice 1.4 · Funnel analytics
--
-- RPC substitui a aproximação antiga de /admin/funnel (que lia só
-- `leads.stage` snapshot). Aqui usamos `lead_events` como fonte da
-- verdade: pra cada stage canônico, contamos quantos leads entraram,
-- quantos avançaram pro próximo stage, e medianas/p90 de tempo.
--
-- Invariants: I-2 (exclui test phones 5555*), I-7 (audit-based, lê events).

create or replace function public.pipeline_conversion_funnel(
  since_days int default 30
)
returns table (
  stage text,
  stage_order int,
  entered bigint,
  exited_to_next bigint,
  dropped bigint,
  median_time_in_stage_h numeric,
  p90_time_in_stage_h numeric
)
language sql
stable
as $$
  with
  stages as (
    select stage, stage_order from (values
      ('greet', 1),
      ('discover', 2),
      ('qualify', 3),
      ('recommend', 4),
      ('schedule', 5),
      ('handoff', 6)
    ) as s(stage, stage_order)
  ),
  eligible_leads as (
    -- Exclui test phones (prefix 5555) e leads de eval (prefix eval-).
    -- I-2: nunca contamos tráfego sintético.
    select id
    from public.leads
    where coalesce(phone, '') not like '5555%'
      and coalesce(phone, '') not like 'eval\_%' escape '\'
  ),
  -- Eventos de mudança de stage dentro da janela temporal.
  stage_events as (
    select
      le.lead_id,
      (le.payload ->> 'to') as to_stage,
      le.at
    from public.lead_events le
    join eligible_leads el on el.id = le.lead_id
    where le.kind = 'stage_change'
      and le.at >= now() - make_interval(days => since_days)
      and (le.payload ->> 'to') is not null
  ),
  -- Pra cada (lead, stage), primeiro momento em que entrou.
  stage_entries as (
    select
      se.lead_id,
      se.to_stage as stage,
      min(se.at) as entered_at
    from stage_events se
    group by se.lead_id, se.to_stage
  ),
  -- Próxima transição (pra computar tempo no stage).
  stage_with_next as (
    select
      sen.lead_id,
      sen.stage,
      sen.entered_at,
      (
        select min(se2.at)
        from stage_events se2
        where se2.lead_id = sen.lead_id
          and se2.at > sen.entered_at
      ) as next_change_at,
      (
        select se2.to_stage
        from stage_events se2
        where se2.lead_id = sen.lead_id
          and se2.at > sen.entered_at
        order by se2.at asc
        limit 1
      ) as next_stage
    from stage_entries sen
  ),
  -- Junta com ordem canônica pra saber se avançou ou retrocedeu.
  stage_analyzed as (
    select
      swn.lead_id,
      swn.stage,
      s.stage_order,
      swn.entered_at,
      swn.next_change_at,
      swn.next_stage,
      ns.stage_order as next_order,
      case
        when ns.stage_order is null then null
        when ns.stage_order > s.stage_order then true
        else false
      end as advanced,
      case
        when swn.next_change_at is null then null
        else extract(epoch from (swn.next_change_at - swn.entered_at)) / 3600.0
      end as hours_in_stage
    from stage_with_next swn
    join stages s on s.stage = swn.stage
    left join stages ns on ns.stage = swn.next_stage
  )
  select
    s.stage,
    s.stage_order,
    coalesce(count(sa.lead_id), 0)::bigint as entered,
    coalesce(count(*) filter (where sa.advanced = true), 0)::bigint as exited_to_next,
    coalesce(count(*) filter (where sa.advanced is null or sa.advanced = false), 0)::bigint as dropped,
    percentile_cont(0.5) within group (order by sa.hours_in_stage)::numeric(10,2) as median_time_in_stage_h,
    percentile_cont(0.9) within group (order by sa.hours_in_stage)::numeric(10,2) as p90_time_in_stage_h
  from stages s
  left join stage_analyzed sa on sa.stage = s.stage
  group by s.stage, s.stage_order
  order by s.stage_order;
$$;

comment on function public.pipeline_conversion_funnel(int) is
  'Funil de conversão baseado em lead_events.stage_change. Exclui leads test (phone 5555*) e eval (id eval-*). Veja docs/VANGUARD_SLICES.md#1.4.';
