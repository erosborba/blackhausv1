-- Fatia I: memória persistente do lead.
--
-- Hoje o graph carrega só `recentMessages(leadId, 12)` + `qualification` JSONB
-- (campos estruturados). Nada sobre o que o lead já expressou em turnos mais
-- antigos: restrições soft ("não curto MCMV"), objeções ("achei caro"), tom
-- percebido, contexto de vida ("vou casar em 6 meses"), perguntas já
-- respondidas que não vale a pena repetir.
--
-- Memória é prose (não JSON) porque:
--   - vai direto pro prompt como um bloco;
--   - Claude escreve e reescreve com facilidade;
--   - não queremos engessar schema num dado que evolui.
--
-- Atualização é incremental: a cada N mensagens novas, um Haiku (barato)
-- reescreve a memória a partir da memória anterior + últimas mensagens.
-- Cap implícito ~300 palavras (o prompt pede pra condensar).

alter table public.leads
  add column if not exists memory text not null default '',
  add column if not exists memory_updated_at timestamptz,
  -- Quantidade de mensagens que o lead tinha quando a memória foi refreshed
  -- por último. Permite calcular "mensagens novas desde o último refresh"
  -- sem precisar varrer timestamps.
  add column if not exists memory_msg_count int not null default 0;

comment on column public.leads.memory is
  'Prose summary do lead mantido incrementalmente por Haiku. Injetado nos prompts do router/answer. Vazio = nunca foi computado ainda.';
