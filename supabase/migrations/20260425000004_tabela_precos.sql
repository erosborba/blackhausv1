-- Tabela de preços estruturada por empreendimento.
-- ========================================================================
-- Estende `unidades` (que antes era só estoque manual com status) pra
-- também guardar o plano de pagamento completo parseado de uma tabela
-- de preços em PDF/XLSX/CSV. Cria `empreendimento_tabelas_precos` pra
-- metadata do upload (com version pra lock otimista) e 3 RPCs de
-- consulta que a Bia usa via agent tools.
--
-- Convivência com o uso antigo:
--   - `unidades.source` diferencia origem: 'manual' (corretor criou na
--     UI ou marcou status de venda) vs 'tabela_precos' (parser populou).
--   - Re-upload só mexe em linhas com source='tabela_precos' preservando
--     `status` atual (caso tenha sido marcado vendido/reservado depois
--     do upload) e linhas 'manual' intocadas.
-- ========================================================================

-- ---------- unidades: colunas novas ----------
alter table public.unidades
  add column if not exists tipologia text,
    -- Texto normalizado vindo do parser (ex: "Studio", "2Q", "2QS Flex",
    -- "Loja"). Paralelo a `tipologia_ref` (que ficou pra o JSONB
    -- empreendimentos.tipologias). Usado pelos filtros da Bia.
  add column if not exists area_privativa numeric,
  add column if not exists area_terraco numeric,
  add column if not exists preco_total numeric,
    -- Canônico: soma(sinal + parcelas × n + reforços + saldo). `preco`
    -- (legacy) continua disponível por compat mas preenchido com o
    -- mesmo valor.
  add column if not exists plano_pagamento jsonb,
    -- { sinal:{parcelas,valor},
    --   mensais:{parcelas,valor},
    --   reforcos:[{data,valor}],
    --   saldo_final:{data,valor} }
  add column if not exists is_comercial boolean not null default false,
    -- true pra lojas (L01, L02) — separadas dos residenciais no retorno
    -- padrão da Bia.
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'tabela_precos')),
  add column if not exists raw_row jsonb,
    -- Linha original (o que o parser extraiu) pra auditoria de divergência.
  add column if not exists tabela_precos_version bigint;
    -- Version da tabela de preços que escreveu essa linha. Vazia pra
    -- entradas manuais. Permite identificar "linhas órfãs" se version
    -- avança e alguma unidade sumiu do novo upload.

-- Index por numero (lookup da Bia) — case-insensitive via lower().
create index if not exists unidades_numero_lookup_idx
  on public.unidades (empreendimento_id, lower(numero));

create index if not exists unidades_tipologia_fts_idx
  on public.unidades (empreendimento_id, tipologia)
  where tipologia is not null;

create index if not exists unidades_preco_total_idx
  on public.unidades (empreendimento_id, preco_total)
  where preco_total is not null;

-- ---------- empreendimento_tabelas_precos ----------
-- Uma linha por empreendimento (enforçado por unique). `version` sobe
-- a cada upload confirmado — usado como lock otimista: o PUT de
-- confirmação exige `expected_version` = version atual; se dois admins
-- preparam preview ao mesmo tempo, só um consegue commitar.
create table if not exists public.empreendimento_tabelas_precos (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  version bigint not null default 1,
    -- Incrementa a cada confirmação. Se um cliente tenta confirmar com
    -- expected_version != version, 409.
  file_path text,
    -- Path no bucket `empreendimentos` (tabela_precos/<empreendimento>/<file>).
  file_name text,
  file_hash text,
    -- sha256 do arquivo. Re-upload idêntico é no-op.
  file_mime text,
  entrega_prevista date,
  disclaimers jsonb not null default '[]'::jsonb,
    -- Strings livres detectadas pelo parser (ex: "Entrega 31/03/2030",
    -- "Correção INCC", "Comissão 4%").
  parse_warnings jsonb not null default '[]'::jsonb,
    -- Linhas que falharam validação aritmética (soma != total ± 0.1%/R$100)
    -- ou que tiveram problema de extração.
  parsed_rows_count int not null default 0,
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
    -- email/role do admin; opcional, só pra auditoria.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists empreendimento_tabelas_precos_unique_idx
  on public.empreendimento_tabelas_precos (empreendimento_id);

drop trigger if exists empreendimento_tabelas_precos_touch_updated_at
  on public.empreendimento_tabelas_precos;
create trigger empreendimento_tabelas_precos_touch_updated_at
  before update on public.empreendimento_tabelas_precos
  for each row execute function public.touch_updated_at();

-- ---------- RPC: consultar unidade por número ----------
-- Match case-insensitive, sem normalização de acento (números não têm).
-- Retorna null row se não existe. Separado do join geral pra a Bia
-- conseguir distinguir "não existe" vs "existe mas vendida".
create or replace function public.unidade_por_numero(
  p_empreendimento_id uuid,
  p_numero text
)
returns table (
  id uuid,
  numero text,
  andar int,
  tipologia text,
  tipologia_ref text,
  area_privativa numeric,
  area_terraco numeric,
  preco_total numeric,
  plano_pagamento jsonb,
  status text,
  is_comercial boolean,
  source text
)
language sql stable as $$
  select
    u.id, u.numero, u.andar, u.tipologia, u.tipologia_ref,
    u.area_privativa, u.area_terraco, u.preco_total, u.plano_pagamento,
    u.status, u.is_comercial, u.source
  from public.unidades u
  where u.empreendimento_id = p_empreendimento_id
    and lower(u.numero) = lower(p_numero)
  limit 1;
$$;

-- ---------- RPC: filtrar unidades ----------
-- Filtros opcionais (null = ignorar). `p_apenas_disponiveis` default true
-- porque o caso comum é "o que tem pra vender".
create or replace function public.unidades_filtrar(
  p_empreendimento_id uuid,
  p_tipologia text default null,
  p_preco_min numeric default null,
  p_preco_max numeric default null,
  p_area_min numeric default null,
  p_andar_min int default null,
  p_andar_max int default null,
  p_apenas_disponiveis boolean default true,
  p_is_comercial boolean default null,
    -- null = ignora; true = só lojas; false = só residencial.
  p_limit int default 20
)
returns table (
  id uuid,
  numero text,
  andar int,
  tipologia text,
  area_privativa numeric,
  area_terraco numeric,
  preco_total numeric,
  plano_pagamento jsonb,
  status text,
  is_comercial boolean
)
language sql stable as $$
  select
    u.id, u.numero, u.andar, u.tipologia,
    u.area_privativa, u.area_terraco, u.preco_total, u.plano_pagamento,
    u.status, u.is_comercial
  from public.unidades u
  where u.empreendimento_id = p_empreendimento_id
    and (p_tipologia is null or lower(u.tipologia) = lower(p_tipologia))
    and (p_preco_min is null or u.preco_total >= p_preco_min)
    and (p_preco_max is null or u.preco_total <= p_preco_max)
    and (p_area_min is null or u.area_privativa >= p_area_min)
    and (p_andar_min is null or u.andar >= p_andar_min)
    and (p_andar_max is null or u.andar <= p_andar_max)
    and (p_apenas_disponiveis is distinct from true or u.status = 'avail')
    and (p_is_comercial is null or u.is_comercial = p_is_comercial)
  order by u.preco_total asc nulls last, u.andar asc, u.numero asc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- ---------- RPC: listar tipologias com agregados ----------
-- "O que tem?" → resume por tipologia. Preço mínimo = referência pra
-- "a partir de".
create or replace function public.unidades_tipologias(p_empreendimento_id uuid)
returns table (
  tipologia text,
  is_comercial boolean,
  total bigint,
  disponivel bigint,
  preco_a_partir numeric,
  preco_ate numeric,
  area_min numeric,
  area_max numeric
)
language sql stable as $$
  select
    coalesce(u.tipologia, '—') as tipologia,
    u.is_comercial,
    count(*)::bigint as total,
    count(*) filter (where u.status = 'avail')::bigint as disponivel,
    min(u.preco_total) filter (where u.status = 'avail') as preco_a_partir,
    max(u.preco_total) filter (where u.status = 'avail') as preco_ate,
    min(u.area_privativa) filter (where u.status = 'avail') as area_min,
    max(u.area_privativa) filter (where u.status = 'avail') as area_max
  from public.unidades u
  where u.empreendimento_id = p_empreendimento_id
    and u.tipologia is not null
  group by u.tipologia, u.is_comercial
  order by u.is_comercial asc, preco_a_partir asc nulls last;
$$;

-- Realtime pra UI de admin atualizar preview.
alter publication supabase_realtime add table public.empreendimento_tabelas_precos;
