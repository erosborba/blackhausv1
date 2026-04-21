-- Vanguard · Track 3 · Slice 3.2 — tabela de ITBI por cidade.
--
-- Per cidade/UF guardamos a alíquota de ITBI em bps (basis points, 100 bps
-- = 1%). ITBI varia cidade-a-cidade (competência municipal), então não
-- tem fórmula — é tabela mesmo. Quando a cidade não está aqui, o caller
-- cai no `finance_itbi_default_bps` do system_settings.
--
-- Chave de busca é `cidade_slug` (normalizado: lowercase, sem acentos,
-- espaços vira '-'). `cidade_display` guarda a forma bonita pra texto
-- pt-BR. UF é char(2) maiúsculo. PK composta (cidade_slug, uf) porque
-- há homônimos entre estados (ex.: "São Miguel" em várias UFs).
--
-- `reg_cartorio_bps` fica nullable — emolumentos de registro são
-- progressivos (tabela CNJ por estado), difícil reduzir a um único
-- percentual. Deixamos aqui pra futuro quando valer a pena modelar.
--
-- Valores do seed são os mais comuns de 2024 pra transmissão de imóvel
-- residencial urbano (categoria financiada). Alguns municípios têm
-- alíquotas progressivas ou descontos pra SFH/MCMV — esta tabela não
-- modela esse refinamento; é ponto de partida razoável pra simulação.

create table if not exists public.cities_fiscal (
  cidade_slug text not null,
    -- Normalizado: lowercase, sem acentos, espaços/pontuação → '-'.
    -- Ex.: "São Paulo" → "sao-paulo", "São José dos Campos" → "sao-jose-dos-campos".
  uf char(2) not null,
  cidade_display text not null,
    -- Forma pt-BR pra colar no texto. Ex.: "São Paulo".
  itbi_bps integer not null,
    -- Alíquota ITBI em bps. 200 = 2.00%, 300 = 3.00%.
  reg_cartorio_bps integer,
    -- Alíquota efetiva média de registro/cartório em bps. Nullable
    -- porque emolumentos são progressivos por faixa (tabela CNJ).
  source text,
    -- Origem/ano do dado. Ex.: "decreto-municipal-2024".
  updated_at timestamptz not null default now(),
  primary key (cidade_slug, uf),
  check (itbi_bps >= 0 and itbi_bps <= 10000),
  check (reg_cartorio_bps is null or (reg_cartorio_bps >= 0 and reg_cartorio_bps <= 10000))
);

create index if not exists cities_fiscal_uf_idx on public.cities_fiscal (uf);

comment on table public.cities_fiscal is
  'ITBI por cidade em bps (100 bps = 1%). Fallback: finance_itbi_default_bps em system_settings quando cidade ausente.';

-- Seed das 27 capitais + algumas cidades-chave de região metropolitana.
-- Fonte: decretos municipais 2024 (valor residencial padrão).
-- Atualizar: nova migration com UPDATE quando a prefeitura mexer.

insert into public.cities_fiscal
  (cidade_slug, uf, cidade_display, itbi_bps, source) values
  -- Sudeste
  ('sao-paulo',          'SP', 'São Paulo',          300, 'decreto-municipal-2024'),
  ('guarulhos',          'SP', 'Guarulhos',          200, 'decreto-municipal-2024'),
  ('campinas',           'SP', 'Campinas',           200, 'decreto-municipal-2024'),
  ('sao-jose-dos-campos','SP', 'São José dos Campos',200, 'decreto-municipal-2024'),
  ('santo-andre',        'SP', 'Santo André',        200, 'decreto-municipal-2024'),
  ('sao-bernardo-do-campo','SP','São Bernardo do Campo',200,'decreto-municipal-2024'),
  ('osasco',             'SP', 'Osasco',             200, 'decreto-municipal-2024'),
  ('ribeirao-preto',     'SP', 'Ribeirão Preto',     200, 'decreto-municipal-2024'),
  ('sorocaba',           'SP', 'Sorocaba',           200, 'decreto-municipal-2024'),
  ('rio-de-janeiro',     'RJ', 'Rio de Janeiro',     300, 'decreto-municipal-2024'),
  ('niteroi',            'RJ', 'Niterói',            200, 'decreto-municipal-2024'),
  ('nova-iguacu',        'RJ', 'Nova Iguaçu',        200, 'decreto-municipal-2024'),
  ('duque-de-caxias',    'RJ', 'Duque de Caxias',    200, 'decreto-municipal-2024'),
  ('belo-horizonte',     'MG', 'Belo Horizonte',     300, 'decreto-municipal-2024'),
  ('contagem',           'MG', 'Contagem',           250, 'decreto-municipal-2024'),
  ('uberlandia',         'MG', 'Uberlândia',         200, 'decreto-municipal-2024'),
  ('juiz-de-fora',       'MG', 'Juiz de Fora',       200, 'decreto-municipal-2024'),
  ('vitoria',            'ES', 'Vitória',            200, 'decreto-municipal-2024'),
  ('vila-velha',         'ES', 'Vila Velha',         200, 'decreto-municipal-2024'),
  -- Sul
  ('curitiba',           'PR', 'Curitiba',           270, 'decreto-municipal-2024'),
  ('londrina',           'PR', 'Londrina',           200, 'decreto-municipal-2024'),
  ('maringa',            'PR', 'Maringá',            200, 'decreto-municipal-2024'),
  ('porto-alegre',       'RS', 'Porto Alegre',       300, 'decreto-municipal-2024'),
  ('caxias-do-sul',      'RS', 'Caxias do Sul',      200, 'decreto-municipal-2024'),
  ('pelotas',            'RS', 'Pelotas',            200, 'decreto-municipal-2024'),
  ('florianopolis',      'SC', 'Florianópolis',      200, 'decreto-municipal-2024'),
  ('joinville',          'SC', 'Joinville',          200, 'decreto-municipal-2024'),
  ('blumenau',           'SC', 'Blumenau',           200, 'decreto-municipal-2024'),
  -- Centro-Oeste
  ('brasilia',           'DF', 'Brasília',           300, 'decreto-distrital-2024'),
  ('goiania',            'GO', 'Goiânia',            200, 'decreto-municipal-2024'),
  ('anapolis',           'GO', 'Anápolis',           200, 'decreto-municipal-2024'),
  ('cuiaba',             'MT', 'Cuiabá',             200, 'decreto-municipal-2024'),
  ('campo-grande',       'MS', 'Campo Grande',       200, 'decreto-municipal-2024'),
  -- Nordeste
  ('salvador',           'BA', 'Salvador',           300, 'decreto-municipal-2024'),
  ('feira-de-santana',   'BA', 'Feira de Santana',   200, 'decreto-municipal-2024'),
  ('fortaleza',          'CE', 'Fortaleza',          200, 'decreto-municipal-2024'),
  ('caucaia',            'CE', 'Caucaia',            200, 'decreto-municipal-2024'),
  ('recife',             'PE', 'Recife',             300, 'decreto-municipal-2024'),
  ('jaboatao-dos-guararapes','PE','Jaboatão dos Guararapes',200,'decreto-municipal-2024'),
  ('olinda',             'PE', 'Olinda',             200, 'decreto-municipal-2024'),
  ('maceio',             'AL', 'Maceió',             150, 'decreto-municipal-2024'),
  ('natal',              'RN', 'Natal',              200, 'decreto-municipal-2024'),
  ('joao-pessoa',        'PB', 'João Pessoa',        200, 'decreto-municipal-2024'),
  ('aracaju',            'SE', 'Aracaju',            200, 'decreto-municipal-2024'),
  ('teresina',           'PI', 'Teresina',           250, 'decreto-municipal-2024'),
  ('sao-luis',           'MA', 'São Luís',           200, 'decreto-municipal-2024'),
  -- Norte
  ('manaus',             'AM', 'Manaus',             200, 'decreto-municipal-2024'),
  ('belem',              'PA', 'Belém',              200, 'decreto-municipal-2024'),
  ('ananindeua',         'PA', 'Ananindeua',         200, 'decreto-municipal-2024'),
  ('porto-velho',        'RO', 'Porto Velho',        200, 'decreto-municipal-2024'),
  ('rio-branco',         'AC', 'Rio Branco',         200, 'decreto-municipal-2024'),
  ('boa-vista',          'RR', 'Boa Vista',          200, 'decreto-municipal-2024'),
  ('macapa',             'AP', 'Macapá',             200, 'decreto-municipal-2024'),
  ('palmas',             'TO', 'Palmas',             200, 'decreto-municipal-2024')
on conflict (cidade_slug, uf) do nothing;
