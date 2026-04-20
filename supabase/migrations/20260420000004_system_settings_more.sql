-- Adiciona settings que faltaram na migration anterior.
INSERT INTO system_settings (key, value, description) VALUES
  ('handoff_max_attempts', '3',    'Máximo de corretores notificados antes de marcar o lead como stuck. Padrão: 3.'),
  ('rag_strong_threshold', '0.55', 'Limiar de similaridade coseno (0.0–1.0) para considerar o RAG como confiável. Abaixo disso a Bia assume que não sabe. Padrão: 0.55.'),
  ('inbound_debounce_ms',  '4000', 'Tempo (ms) de espera para agrupar mensagens rápidas do mesmo lead antes de processar. Padrão: 4000 (4 s).'),
  ('memory_refresh_every', '8',    'A cada quantas mensagens novas a memória persistente do lead é reescrita pelo Haiku. Padrão: 8.')
ON CONFLICT (key) DO NOTHING;
