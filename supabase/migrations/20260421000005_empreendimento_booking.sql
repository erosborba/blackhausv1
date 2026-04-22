-- =========================================================
-- Booking digital por empreendimento
--
-- PDF único que a Bia envia direto pro lead via Evolution quando
-- a tool `enviar_booking` for acionada. Não entra na base de
-- conhecimento (sem RAG/embedding) — é material de venda, não
-- contexto pra IA responder. Armazena só o path do storage; a
-- signed URL é gerada on-demand.
-- =========================================================

alter table public.empreendimentos
  add column if not exists booking_digital_path text;
