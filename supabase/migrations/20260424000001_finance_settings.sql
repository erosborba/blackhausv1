-- Vanguard · Track 3 · Slice 3.0 — settings de simulação financeira.
--
-- Todas as features de Track 3 (MCMV + simulação SBPE/SAC) ficam atrás de
-- kill switches, com guardrail default ativo (não simula sem preço
-- explícito — vindo do lead ou do empreendimento via `preco_inicial`).
--
-- Admin pode desligar tudo, afrouxar o guardrail, ou ajustar valores de
-- mercado (taxa SBPE, ITBI) sem mexer em código. Faixas MCMV e fórmulas
-- continuam hardcoded em `src/lib/finance.ts` — são regra pública, mudam
-- via nova migration quando a Caixa revisa.
--
-- Unidade de taxas: bps (basis points) pra evitar float em TEXT. Ex.:
-- 1150 bps = 11.50% a.a.  A lib converte pra decimal na leitura.

INSERT INTO system_settings (key, value, description) VALUES
  ('finance_enabled',               'true',
   'Kill switch geral do Track 3. Se false, tools simulate_financing e check_mcmv são desregistradas do agent.'),
  ('finance_simulate_enabled',      'true',
   'Habilita a tool simulate_financing (SBPE/SAC). Depende de finance_enabled.'),
  ('finance_mcmv_enabled',          'true',
   'Habilita a tool check_mcmv (elegibilidade + faixas). Depende de finance_enabled.'),
  ('finance_require_explicit_price', 'true',
   'Guardrail: se true, a Bia só simula com preço vindo do lead OU do empreendimento (preco_inicial). Se false, aceita valores genéricos por conta própria (risco de mal-entendido).'),
  ('finance_default_entry_pct',     '20',
   'Entrada padrão (%) quando o lead não informa. Usado em simulate_financing como sugestão.'),
  ('finance_default_term_months',   '360',
   'Prazo padrão (meses) quando o lead não informa. 360 = 30 anos.'),
  ('finance_sbpe_rate_annual_bps',  '1150',
   'Taxa SBPE anual em basis points (1 bp = 0.01%). 1150 = 11.50% a.a. Referência de mercado 2024. Atualizar quando Selic mexer.'),
  ('finance_itbi_default_bps',      '200',
   'Alíquota ITBI default em bps quando a cidade não está em cities_fiscal. 200 = 2.00%.')
ON CONFLICT (key) DO NOTHING;
