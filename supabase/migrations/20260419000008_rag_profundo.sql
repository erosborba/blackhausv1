-- Fatia C — RAG profundo.
--
-- Duas adições:
--
--  1. `empreendimentos.raw_knowledge jsonb[]` — armazena os chunks de texto
--     que o Claude extraiu dos PDFs no upload. Guardar aqui (vs só re-chamar
--     Claude) permite reindexar o RAG sem custar $ a cada mudança de schema.
--
--     Shape de cada entry:
--       {
--         "section": "Memorial descritivo" | "Acabamentos" | ...,
--         "text": "...",           // conteúdo semântico, NÃO o PDF inteiro
--         "source_file": "book.pdf",
--         "added_at": "2026-04-19T..."
--       }
--
--  2. `empreendimento_faqs` — perguntas/respostas cadastradas pelo corretor
--     ou geradas pela IA. Cada FAQ vira um chunk no RAG (kind: "faq") no
--     próximo reindex.

alter table public.empreendimentos
  add column if not exists raw_knowledge jsonb not null default '[]'::jsonb;

comment on column public.empreendimentos.raw_knowledge is
  'Chunks de texto extraídos de documentos (não o PDF bruto — trechos semanticamente segmentados pelo Claude no upload). Usado como fonte pro RAG profundo.';

-- ─── FAQ ─────────────────────────────────────────────────────────────────────

create table if not exists public.empreendimento_faqs (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id) on delete cascade,
  question text not null,
  answer text not null,
  source text not null default 'manual' check (source in ('manual', 'ai_generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faqs_emp_idx on public.empreendimento_faqs (empreendimento_id);

-- Trigger de updated_at.
create or replace function public.touch_faq_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists faq_touch_updated on public.empreendimento_faqs;
create trigger faq_touch_updated
  before update on public.empreendimento_faqs
  for each row execute function public.touch_faq_updated_at();

-- Realtime pro dashboard refletir mudanças ao vivo (se vier a usar).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'empreendimento_faqs'
  ) then
    alter publication supabase_realtime add table public.empreendimento_faqs;
  end if;
end $$;
