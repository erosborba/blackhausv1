-- =========================================================
-- Lumihaus SDR — initial schema migration
-- Idempotente: dropa as tabelas/funcs do projeto (CASCADE) antes de recriar.
-- =========================================================

-- ---------- DROP (apenas o que é nosso) ----------
-- Triggers caem junto com as tabelas (cascade).
drop table if exists public.appointments cascade;
drop table if exists public.empreendimento_chunks cascade;
drop table if exists public.empreendimentos cascade;
drop table if exists public.messages cascade;
drop table if exists public.leads cascade;

drop function if exists public.match_empreendimento_chunks(vector, int, jsonb);
drop function if exists public.touch_updated_at() cascade;

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------- LEADS ----------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  push_name text,
  full_name text,
  email text,
  status text not null default 'new',
    -- new | qualifying | qualified | scheduled | won | lost | nurturing
  stage text,
    -- greet | discover | qualify | recommend | schedule | handoff
  qualification jsonb not null default '{}'::jsonb,
  interest_empreendimentos uuid[] not null default '{}',
  last_message_at timestamptz,
  human_takeover boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_status_idx on public.leads(status);
create index leads_phone_idx on public.leads(phone);

-- ---------- MENSAGENS ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  evolution_message_id text,
  evolution_event jsonb,
  created_at timestamptz not null default now()
);

create index messages_lead_idx on public.messages(lead_id, created_at);
create index messages_evo_id_idx on public.messages(evolution_message_id);

-- ---------- EMPREENDIMENTOS ----------
create table public.empreendimentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text unique,
  construtora text,
  status text,             -- lancamento | em_obras | pronto_para_morar
  endereco text,
  bairro text,
  cidade text,
  estado text,
  preco_inicial numeric,
  tipologias jsonb not null default '[]'::jsonb,
  diferenciais text[] not null default '{}',
  lazer text[] not null default '{}',
  entrega date,
  descricao text,
  midias jsonb not null default '[]'::jsonb,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index emp_bairro_idx on public.empreendimentos(bairro);
create index emp_cidade_idx on public.empreendimentos(cidade);
create index emp_status_idx on public.empreendimentos(status);

-- ---------- RAG ----------
create table public.empreendimento_chunks (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index emp_chunks_emp_idx on public.empreendimento_chunks(empreendimento_id);
create index emp_chunks_embedding_idx
  on public.empreendimento_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_empreendimento_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  empreendimento_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.empreendimento_id,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.empreendimento_chunks c
  where c.metadata @> filter
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ---------- APPOINTMENTS ----------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  scheduled_at timestamptz not null,
  channel text not null default 'visita',  -- visita | call | tour_virtual
  status text not null default 'pending',  -- pending | confirmed | done | canceled
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- TRIGGER updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_touch_leads before update on public.leads
  for each row execute function public.touch_updated_at();

create trigger trg_touch_emp before update on public.empreendimentos
  for each row execute function public.touch_updated_at();
