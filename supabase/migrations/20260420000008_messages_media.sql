-- =========================================================
-- Multimodal: áudio + imagem do lead. Colunas extras em messages
-- guardam a referência pro blob no bucket `messages-media`. `content`
-- continua sendo o texto que vai pra Bia (transcript ou descrição).
-- =========================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_type TEXT
    CHECK (media_type IN ('audio', 'image', 'video')),
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_duration_ms INT;

CREATE INDEX IF NOT EXISTS messages_media_type_idx
  ON public.messages(media_type)
  WHERE media_type IS NOT NULL;

-- Bucket privado pra blobs. Cleanup diário aplica TTL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messages-media',
  'messages-media',
  false,
  26214400, -- 25 MiB
  ARRAY[
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "service role manages messages-media bucket" ON storage.objects;
CREATE POLICY "service role manages messages-media bucket"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'messages-media')
  WITH CHECK (bucket_id = 'messages-media');

-- Settings. Defaults ligados pra não surpreender (a Bia sem isso ignora áudio).
INSERT INTO system_settings (key, value, description) VALUES
  ('media_audio_enabled',    'true', 'Habilita transcrição de áudio (Whisper) e resposta da Bia. Default: ligado.'),
  ('media_image_enabled',    'true', 'Habilita visão (Haiku vision) em imagens enviadas pelo lead. Default: ligado.'),
  ('media_max_size_mb',      '20',   'Tamanho máximo de mídia aceita (MB). Acima disso, fallback automático.'),
  ('media_retention_days',   '30',   'Dias para manter áudios/imagens no storage antes do cleanup automático.')
ON CONFLICT (key) DO NOTHING;
