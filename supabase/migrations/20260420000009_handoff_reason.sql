-- Handoff estruturado (Tier 3 #2).
--
-- Até aqui o handoff era booleano (needsHandoff/handoff_notified_at) e o
-- "motivo" só aparecia como string livre na notificação WhatsApp pro
-- corretor (não persistia). Agora armazenamos motivo canônico + urgência
-- pra:
--   1. Corretor triagiar pela tela (🔴 urgência alta primeiro)
--   2. Dashboard /admin/funnel breakdown por motivo
--   3. Futuros evals / métricas de qualidade do router
--
-- Taxonomia fixa (enum emulado via CHECK, mais simples de evoluir do que
-- ENUM Postgres — novas categorias = novo deploy, sem migration dolorosa).

alter table public.leads
  add column if not exists handoff_reason text,
  add column if not exists handoff_urgency text;

-- Valores aceitos. `lead_pediu_humano` é o baseline (default quando o lead
-- diz literalmente "quero falar com alguém"). Os outros vêm do router/código.
alter table public.leads
  drop constraint if exists leads_handoff_reason_check;
alter table public.leads
  add constraint leads_handoff_reason_check check (
    handoff_reason is null or handoff_reason in (
      'lead_pediu_humano',
      'fora_de_escopo',
      'objecao_complexa',
      'ia_incerta',
      'urgencia_alta',
      'escalacao',
      'outro'
    )
  );

alter table public.leads
  drop constraint if exists leads_handoff_urgency_check;
alter table public.leads
  add constraint leads_handoff_urgency_check check (
    handoff_urgency is null or handoff_urgency in ('baixa', 'media', 'alta')
  );

-- Index parcial pra o funnel: só linhas com handoff registrado.
create index if not exists leads_handoff_reason_idx
  on public.leads(handoff_reason)
  where handoff_reason is not null;
