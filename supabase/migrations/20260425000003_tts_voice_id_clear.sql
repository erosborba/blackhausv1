-- =========================================================
-- Vanguard · Track 4 · Fix — limpa voice_id fantasma seedado
-- =========================================================
-- A migration 20260425000001 seedou `tts_voice_id` com
-- 'aBaVz2FTZkqVNXrDkzMV' — um ID placeholder que não existe em
-- nenhuma conta ElevenLabs e causava 404 na síntese.
--
-- Zeramos o valor aqui: setting vazio → precedência cai pro
-- env.ELEVENLABS_VOICE_ID (ver tts.ts linha 83-85). Operador
-- que quiser override via UI (/ajustes → Voz (TTS) → Voice ID)
-- pode preencher; agora com inputType=text a string alfanumérica
-- passa intacta.
-- =========================================================

UPDATE system_settings
SET value = ''
WHERE key = 'tts_voice_id'
  AND value = 'aBaVz2FTZkqVNXrDkzMV';
