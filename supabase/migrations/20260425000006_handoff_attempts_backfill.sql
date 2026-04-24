-- ========================================================================
-- Backfill: zera handoff_attempts em leads que NÃO têm ciclo ativo.
-- ========================================================================
-- Mudança de semântica acompanhante:
--   `handoff_attempts` agora é por CICLO de handoff, não pela vida do lead.
--   Reset acontece em closeBridge (corretor /fim) e quando gestor marca
--   handoff_resolved_at via UI de revisão.
--
-- Sem este backfill, leads longevos (ex: da91854c com attempts=5 acumulado
-- em 6 handoffs de dias diferentes) continuariam caindo direto em
-- handoff_stuck na primeira escalação por timeout do próximo ciclo.
--
-- Critério "ciclo encerrado": handoff_resolved_at IS NOT NULL E
-- bridge_active=false. Mantém attempts em leads com ciclo aberto pra
-- não desarmar a guarda anti-loop deles.
-- ========================================================================

update public.leads
set handoff_attempts = 0
where handoff_attempts > 0
  and bridge_active = false
  and (
    handoff_resolved_at is not null
    or handoff_notified_at is null
  );
