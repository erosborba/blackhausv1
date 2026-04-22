-- Vanguard · Track 4 · Slice 4.1 — bucket de cache TTS.
--
-- Saudações ("oi!", "bom dia!", "vou te mandar já") vão se repetir pra
-- todo lead novo; renderizar via ElevenLabs a cada vez é desperdício
-- de $ e latência. O client em `src/lib/tts.ts` calcula sha256 de
-- (voice_id + model + text) e consulta esse bucket antes de chamar a
-- API — hit devolve o mp3 direto.
--
-- Bucket é privado; downloads são servidos via signed URL só dentro
-- do nosso backend (o blob vai pro Evolution via sendMedia base64).
-- Cleanup: blobs aqui são reutilizáveis e pequenos (~50 KB cada
-- saudação). Não aplicar TTL agressivo; vale manter o cache quente.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tts-cache',
  'tts-cache',
  false,
  5242880, -- 5 MiB (um mp3 de TTS tipicamente fica entre 10-200 KB)
  ARRAY['audio/mpeg']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "service role manages tts-cache bucket" ON storage.objects;
CREATE POLICY "service role manages tts-cache bucket"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'tts-cache')
  WITH CHECK (bucket_id = 'tts-cache');

-- Settings. Defaults conservadores — ligado só depois da calibração
-- do decision node em 4.3.
INSERT INTO system_settings (key, value, description) VALUES
  ('tts_enabled',         'false', 'Habilita TTS outbound. Só liga depois de 4.3/4.4 testadas.'),
  ('tts_daily_cap_brl',   '10',    'Teto diário em R$ pra síntese TTS. Acima disso, Bia cai pra texto.'),
  ('tts_voice_id',        'aBaVz2FTZkqVNXrDkzMV', 'Voice ID da ElevenLabs. Sobrescreve env se setado aqui.')
ON CONFLICT (key) DO NOTHING;

-- Estende o CHECK de providers em ai_usage_log pra aceitar 'elevenlabs'.
-- Tabela foi criada em 20260419000009 com check ('anthropic', 'openai').
-- Drop + recria pra incluir o novo.
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('anthropic', 'openai', 'elevenlabs'));
