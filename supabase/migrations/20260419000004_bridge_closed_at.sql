-- Distingue "ponte nunca aberta" de "ponte fechada por /fim".
-- Usado na copy do forward pro corretor (⏳ aguardando vs 💭 encerrada).

alter table public.leads
  add column if not exists bridge_closed_at timestamptz;
