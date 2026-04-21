-- Vanguard · Track 3 · Slice 3.5a — tabela de sugestões do copilot.
--
-- Quando `finance_*_mode='copilot'`, a tool não manda resultado pro lead;
-- grava aqui pra corretor revisar no /inbox. 3.6 constrói a UI e a
-- criação automática de handoff; 3.5a só firma o storage + fail-closed.
--
-- Escopo: Track 3 (simulation | mcmv). Projetado pra acomodar outros
-- kinds no futuro (ex.: outreach drafts do Track 5) sem migration nova.
--
-- Lifecycle:
--   pending → sent         (corretor clicou enviar; sent_message_id aponta pro outbound)
--   pending → sent (edited)(corretor ajustou texto; edited_text preservado)
--   pending → discarded    (corretor descartou; discarded_reason opcional)
--   pending → (expired)    (lead resolveu sozinho, corretor limpa via UI)
--
-- Idempotência: NÃO garantida no banco. A lógica do wrapper evita
-- duplicatas checando se já existe pending para o mesmo lead + kind +
-- payload-hash nos últimos N segundos (regra em 3.6).

create table if not exists public.copilot_suggestions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('simulation', 'mcmv')),
    -- Kind decide rendering no /inbox. Projetado pra extensão futura;
    -- se um novo kind chegar, adicionar no CHECK + UI.
  payload jsonb not null,
    -- Snapshot completo dos números (entrada, principal, taxa, parcelas,
    -- etc). Fonte da verdade pra re-renderizar o card mesmo se a lib de
    -- finance mudar depois.
  text_preview text not null,
    -- Texto pt-BR pronto que o corretor vê como preview e pode enviar
    -- sem editar. Gerado pela função pura (computeSimulationResponse ou
    -- computeMcmvResponse) no momento da sugestão.
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'discarded')),
  edited_text text,
    -- Se corretor editou antes de enviar, preservamos o original em
    -- text_preview e gravamos o ajuste aqui. Para telemetria de quanto
    -- a Bia escreveu bem (quantas sugestões foram enviadas sem editar).
  discarded_reason text,
    -- Livre: "taxa desatualizada", "lead já sabia", "preço errado" etc.
  sent_message_id uuid references public.messages(id) on delete set null,
    -- Link pro outbound gerado quando corretor clicou enviar.
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
    -- Quando status saiu de 'pending' (sent_at ou discarded_at mesclado).
  created_by text,
    -- 'bia' (tool invocation) | 'corretor:<uuid>' (ajuste manual futuro)
  meta jsonb
    -- Extensão: price_source, promise_text enviado pela Bia, etc.
);

create index if not exists copilot_suggestions_lead_status_idx
  on public.copilot_suggestions (lead_id, status, created_at desc);

create index if not exists copilot_suggestions_pending_idx
  on public.copilot_suggestions (created_at desc)
  where status = 'pending';

comment on table public.copilot_suggestions is
  'Sugestões geradas pelas tools de Track 3 em modo copilot. Corretor revisa no /inbox e envia/descarta. Fail-closed: Bia não consegue vazar números pro lead sem o corretor clicar enviar.';

-- Realtime pra UI do /inbox refletir sugestões novas em tempo real.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'copilot_suggestions'
  ) then
    alter publication supabase_realtime add table public.copilot_suggestions;
  end if;
end $$;
