-- Configurações do sistema editáveis via painel admin.
-- Cada linha é uma chave única com valor texto e descrição legível.

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Valores iniciais
INSERT INTO system_settings (key, value, description) VALUES
  ('handoff_escalation_ms', '300000',  'Tempo (ms) até escalar para o próximo corretor quando não há resposta. Padrão: 300000 (5 min).'),
  ('handoff_max_attempts',  '3',       'Máximo de corretores notificados antes de marcar o lead como stuck. Padrão: 3.'),
  ('rag_strong_threshold',  '0.55',    'Limiar de similaridade coseno (0.0–1.0) para considerar o RAG como confiável. Abaixo disso a Bia assume que não sabe. Padrão: 0.55.'),
  ('inbound_debounce_ms',   '4000',    'Tempo (ms) de espera para agrupar mensagens rápidas do mesmo lead antes de processar. Padrão: 4000 (4 s).'),
  ('memory_refresh_every',  '8',       'A cada quantas mensagens novas a memória persistente do lead é reescrita pelo Haiku. Padrão: 8.')
ON CONFLICT (key) DO NOTHING;
