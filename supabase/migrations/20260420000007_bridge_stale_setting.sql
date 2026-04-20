-- Setting para auto-close de pontes stale (corretor esqueceu /fim).
--
-- O cleanup diário fecha pontes cujo lead não trocou nenhuma mensagem há
-- mais de N horas. Sem isso, lead fica em limbo: Bia bloqueada (bridge_active),
-- follow-up bloqueado (filtra bridge_active=false), e corretor esqueceu.

INSERT INTO system_settings (key, value, description) VALUES
  ('bridge_stale_hours', '48', 'Horas sem troca de mensagens para auto-fechar ponte esquecida. Default: 48h.')
ON CONFLICT (key) DO NOTHING;
