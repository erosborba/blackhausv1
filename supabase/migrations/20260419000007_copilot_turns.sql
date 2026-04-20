-- Histórico de conversa corretor ↔ Bia no modo copiloto.
--
-- Cada turno (pergunta do corretor OU resposta da Bia) vira uma linha.
-- brokerCopilot carrega os últimos N turnos do agente pra ter contexto de
-- continuidade ("mais detalhes" → Bia lembra do que tava falando).
--
-- Não mistura com a tabela `messages` (que é lead↔Bia) porque:
--  • São domínios diferentes (messages tem lead_id obrigatório).
--  • Evita ruído em queries do lead timeline.
--  • Permite TTL agressivo aqui (a gente só quer memória curta).

create table if not exists public.copilot_turns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Lookup por agente, ordem cronológica reversa (últimos N).
create index if not exists copilot_turns_agent_time_idx
  on public.copilot_turns (agent_id, created_at desc);
