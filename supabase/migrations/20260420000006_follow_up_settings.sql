-- Settings do sistema de follow-up. Tudo editável via /admin/configuracoes.
--
-- Default `followup_enabled = false` intencional — sistema só dispara após
-- ativação explícita no painel (segurança contra flood em primeiro deploy).

INSERT INTO system_settings (key, value, description) VALUES
  ('followup_enabled',        'false', 'Liga/desliga o sistema de follow-up automático. false = nenhum envio.'),
  ('followup_step_1_days',    '3',     'Dias após a última mensagem do lead para o 1º follow-up. Padrão: 3.'),
  ('followup_step_2_days',    '7',     'Dias após o 1º follow-up (sem resposta) para o 2º. Padrão: 7.'),
  ('followup_step_3_days',    '14',    'Dias após o 2º follow-up (sem resposta) para o 3º e último. Padrão: 14.'),
  ('followup_rate_per_min',   '3',     'Máximo de follow-ups enviados por minuto (anti-ban WhatsApp). Padrão: 3.'),
  ('followup_window_start',   '9',     'Hora do dia (0-23) a partir da qual pode enviar. Padrão: 9 (9h).'),
  ('followup_window_end',     '20',    'Hora do dia (0-23) até a qual pode enviar. Padrão: 20 (20h).'),
  ('followup_min_msgs_lead',  '3',     'Mínimo de mensagens na conversa para o lead ser elegível (evita cold leads). Padrão: 3.')
ON CONFLICT (key) DO NOTHING;
