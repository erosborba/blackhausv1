-- Sistema de follow-up automático (nurturing) da Bia.
--
-- Cada row é uma etapa agendada de follow-up para um lead. O sistema é
-- auditável: guardamos o texto exato enviado, o timestamp de envio, e o
-- motivo de cancelamento quando aplicável.
--
-- Steps: 1 (primeiro toque após silêncio), 2 (reforço), 3 (última chamada).
-- Intervalos configuráveis via system_settings (followup_step_N_days).
--
-- Status transitions:
--   pending → sent       (disparo ok)
--   pending → cancelled  (lead respondeu, bridge aberto, takeover, etc.)
--   pending → failed     (erro ao enviar — mantém row pra investigar)

CREATE TABLE IF NOT EXISTS follow_ups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  step            INT  NOT NULL CHECK (step BETWEEN 1 AND 5),
  scheduled_for   TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  message         TEXT,
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cron filtra por scheduled_for + status
CREATE INDEX IF NOT EXISTS follow_ups_due
  ON follow_ups(scheduled_for)
  WHERE status = 'pending';

-- Lookup por lead (cancelamento em massa + auditoria)
CREATE INDEX IF NOT EXISTS follow_ups_lead
  ON follow_ups(lead_id, created_at DESC);

-- 1 pending por (lead, step) — idempotente contra duplicatas
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_lead_step_pending
  ON follow_ups(lead_id, step)
  WHERE status = 'pending';
