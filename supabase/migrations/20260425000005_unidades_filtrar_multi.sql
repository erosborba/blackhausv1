-- ========================================================================
-- RPC: filtrar unidades em MÚLTIPLOS empreendimentos.
-- ========================================================================
-- Caso de uso: lead pergunta "tem studio até 400 mil?" sem citar nome do
-- prédio. A Bia precisa varrer todos os empreendimentos ativos com tabela
-- carregada e devolver matches agregados pra responder algo concreto em vez
-- de "vou perguntar pro consultor".
--
-- Decisão: nova função em vez de tornar `p_empreendimento_id` da
-- `unidades_filtrar` nullable — preserva o contrato existente (tool da Bia
-- continua chamando a versão single quando há alvo claro). Retorno traz
-- `empreendimento_id`/`empreendimento_nome` por linha pra render agrupado.
-- ========================================================================

create or replace function public.unidades_filtrar_multi(
  p_empreendimento_ids uuid[] default null, -- null = todos os ativos
  p_tipologia text default null,
  p_preco_min numeric default null,
  p_preco_max numeric default null,
  p_area_min numeric default null,
  p_andar_min int default null,
  p_andar_max int default null,
  p_apenas_disponiveis boolean default true,
  p_is_comercial boolean default null,
  p_limit_per_emp int default 5,
  p_limit_total int default 30
)
returns table (
  empreendimento_id uuid,
  empreendimento_nome text,
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
  with ranked as (
    select
      u.empreendimento_id,
      e.nome as empreendimento_nome,
      u.id, u.numero, u.andar, u.tipologia,
      u.area_privativa, u.area_terraco, u.preco_total, u.plano_pagamento,
      u.status, u.is_comercial,
      row_number() over (
        partition by u.empreendimento_id
        order by u.preco_total asc nulls last, u.andar asc, u.numero asc
      ) as rn
    from public.unidades u
    join public.empreendimentos e on e.id = u.empreendimento_id
    where e.ativo = true
      and (p_empreendimento_ids is null or u.empreendimento_id = any(p_empreendimento_ids))
      and (p_tipologia is null or lower(u.tipologia) = lower(p_tipologia))
      and (p_preco_min is null or u.preco_total >= p_preco_min)
      and (p_preco_max is null or u.preco_total <= p_preco_max)
      and (p_area_min is null or u.area_privativa >= p_area_min)
      and (p_andar_min is null or u.andar >= p_andar_min)
      and (p_andar_max is null or u.andar <= p_andar_max)
      and (p_apenas_disponiveis is distinct from true or u.status = 'avail')
      and (p_is_comercial is null or u.is_comercial = p_is_comercial)
  )
  select
    empreendimento_id, empreendimento_nome, id, numero, andar, tipologia,
    area_privativa, area_terraco, preco_total, plano_pagamento, status, is_comercial
  from ranked
  where rn <= greatest(1, least(coalesce(p_limit_per_emp, 5), 20))
  order by preco_total asc nulls last, empreendimento_nome asc, numero asc
  limit greatest(1, least(coalesce(p_limit_total, 30), 100));
$$;
