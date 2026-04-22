-- Vanguard · Track 4 · Slice 4.4 — budget TTS em USD.
--
-- O cap original criado em 4.1 era em BRL (`tts_daily_cap_brl = 10`).
-- Problema: ElevenLabs cobra em USD, a gente não tem mesa de câmbio
-- real — hardcodar uma taxa vira ruído conforme o dólar mexe. Mais
-- limpo é operar o cap direto em USD.
--
-- Esta migration:
--   1. Cria `tts_daily_cap_usd` = 2.00 (operador "não gastar mais de
--      $2/dia em TTS até eu calibrar").
--   2. Deixa `tts_daily_cap_brl` existindo mas desconectado do código
--      (não removemos pra não quebrar eventual integração externa).
--
-- O dashboard `/ajustes` expõe o novo em USD. Operador pensa em USD
-- mesmo — o custo real do serviço.

INSERT INTO system_settings (key, value, description) VALUES
  ('tts_daily_cap_usd', '2.00',
   'Teto diário em USD pra síntese ElevenLabs. Acima disso, Bia cai pra texto. $2/dia cobre ~60k chars ou ~1500 saudações cacheáveis.')
ON CONFLICT (key) DO NOTHING;

-- Atualiza comment do _brl pra sinalizar que tá deprecated.
UPDATE system_settings
  SET description = '[DEPRECATED em 4.4 — use tts_daily_cap_usd] Teto diário em R$ pra síntese TTS.'
  WHERE key = 'tts_daily_cap_brl';
