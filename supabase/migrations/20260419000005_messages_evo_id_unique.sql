-- Idempotência de webhook: garante que um mesmo evolution_message_id nunca
-- gera duas linhas em messages, mesmo que dois processos tentem inserir em
-- paralelo (race no SELECT de dedup). Complementa a checagem em handleOne.
--
-- IMPORTANTE: antes de aplicar, limpe duplicatas existentes — senão a criação
-- do índice falha. Consulta de diagnóstico:
--   select evolution_message_id, count(*)
--   from messages
--   where evolution_message_id is not null
--   group by 1 having count(*) > 1;
-- Cleanup (mantém o mais antigo):
--   delete from messages m1 using messages m2
--   where m1.evolution_message_id = m2.evolution_message_id
--     and m1.evolution_message_id is not null
--     and m1.created_at > m2.created_at;

-- Remove o índice não-único antigo pra não sobrar redundante.
drop index if exists messages_evo_id_idx;

create unique index if not exists messages_evolution_message_id_unique
  on public.messages(evolution_message_id)
  where evolution_message_id is not null;
