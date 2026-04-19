-- =========================================================
-- Storage bucket para arquivos de empreendimentos
-- (PDFs descritivos, planilhas de valores, fotos)
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'empreendimentos',
  'empreendimentos',
  false,
  52428800, -- 50 MiB
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Policies: apenas service_role escreve/lê. Admin UI usa service-role via
-- API routes no servidor. Sem acesso anônimo.
drop policy if exists "service role manages empreendimentos bucket" on storage.objects;
create policy "service role manages empreendimentos bucket"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'empreendimentos')
  with check (bucket_id = 'empreendimentos');
