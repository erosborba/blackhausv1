-- =========================================================
-- Galeria de fotos por empreendimento
--
-- Array de imagens categorizadas (fachada, lazer, decorado, planta,
-- vista, outros) com legenda. Material visual pra Bia enviar via
-- Evolution numa futura tool. NÃO entra em RAG/embeddings — é mídia
-- de venda, não contexto pra IA responder texto.
-- =========================================================

alter table public.empreendimentos
  add column if not exists fotos jsonb not null default '[]'::jsonb;
