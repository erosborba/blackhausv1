-- Fila persistente de escalações de handoff.
--
-- Substitui o Map<leadId, setTimeout> em memória por uma tabela que sobrevive
-- a restarts do servidor. O cron /api/cron/handoff (1x/min) processa as linhas
-- com scheduled_for <= NOW() e status = 'pending'.
--
-- Índice único parcial garante no máximo 1 escalação pendente por lead —
-- idempotente mesmo com corrida entre instâncias.

CREATE TABLE IF NOT EXISTS handoff_escalations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'fired', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1 pending por lead (equivalente ao Map.set que sobrescrevia o timer anterior)
CREATE UNIQUE INDEX IF NOT EXISTS handoff_escalations_lead_pending
  ON handoff_escalations(lead_id)
  WHERE status = 'pending';

-- Cron faz range scan por scheduled_for
CREATE INDEX IF NOT EXISTS handoff_escalations_due
  ON handoff_escalations(scheduled_for)
  WHERE status = 'pending';
