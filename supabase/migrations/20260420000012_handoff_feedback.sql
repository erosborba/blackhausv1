-- Phase 2 — Handoff Feedback (TECH_DEBT Tier 3 #1)
-- ========================================================================
-- Depois que um handoff dispara, o corretor sabe se a Bia acertou ou não
-- (foi no momento certo? lead era bom? ela segurou demais?). Precisamos
-- capturar esse sinal pra:
--   (a) mostrar "acurácia de handoff" no /gestor (dash operacional)
--   (b) alimentar few-shots pro router decidir quando escalar no futuro
--   (c) flaggear leads 'ruim' pra descartar do score/pipeline
--
-- Uma linha por handoff event: o corretor pode reavaliar depois, então
-- conservamos histórico em vez de UPSERT. O "último rating" é o que vale
-- na UI, mas o histórico fica pra auditoria/eval.
-- ========================================================================

create table if not exists public.handoff_feedback (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  rating text not null,
    -- 'bom'       → handoff na hora certa, lead quente, Bia acertou
    -- 'cedo'      → Bia escalou rápido demais, devia ter qualificado mais
    -- 'tarde'     → Bia segurou demais, lead esfriou / perdeu janela
    -- 'lead_ruim' → não é problema da Bia — lead não tinha fit / era spam
  note text,
  actor text,
    -- 'corretor:<id>' | 'gestor:<id>' | 'system'
  at timestamptz not null default now()
);

alter table public.handoff_feedback
  drop constraint if exists handoff_feedback_rating_check;
alter table public.handoff_feedback
  add constraint handoff_feedback_rating_check check (
    rating in ('bom', 'cedo', 'tarde', 'lead_ruim')
  );

create index if not exists handoff_feedback_lead_at_idx
  on public.handoff_feedback (lead_id, at desc);

create index if not exists handoff_feedback_rating_idx
  on public.handoff_feedback (rating, at desc);

-- ---------- RPC: acurácia agregada ----------
-- Uso: /api/gestor/handoff-accuracy. Agrega últimos N dias por rating,
-- devolve contagens + lead_count distinto (um lead pode ter feedbacks
-- múltiplos se reavaliado).
create or replace function public.handoff_feedback_stats(p_since_days int default 30)
returns table (
  rating text,
  count bigint,
  lead_count bigint
)
language sql stable as $$
  select
    rating,
    count(*)::bigint as count,
    count(distinct lead_id)::bigint as lead_count
  from public.handoff_feedback
  where at >= now() - (greatest(1, p_since_days) || ' days')::interval
  group by rating
  order by count desc;
$$;

-- ---------- View: último feedback por lead ----------
-- Pra UI do thread: "qual foi a última avaliação deste handoff?".
-- Se nunca avaliado, lead não aparece.
create or replace view public.handoff_feedback_latest as
  select distinct on (lead_id)
    lead_id, id, rating, note, actor, at
  from public.handoff_feedback
  order by lead_id, at desc;

-- Realtime: gestor pode ficar olhando o dash — publica tabela.
alter publication supabase_realtime add table public.handoff_feedback;
