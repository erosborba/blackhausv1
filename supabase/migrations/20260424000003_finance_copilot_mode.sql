-- Vanguard · Track 3 · Slice 3.5a — modo copilot-only pra tools financeiras.
--
-- Decisão 2026-04-24: calculos financeiros NÃO vão direto ao lead por
-- default. Simulação errada (taxa desatualizada, ITBI da cidade errada,
-- MCMV com 'primeiro imóvel' mal classificado, ancoragem numérica que
-- ignora custos extras) é assimetricamente ruim — 1 erro em 100 destrói
-- confiança ganha nos outros 99.
--
-- Novos settings por tool: 'copilot' (default seguro) ou 'direct' (admin
-- afrouxa quando confiar). 'off' fica implicitamente coberto pelos
-- existentes `finance_simulate_enabled`/`finance_mcmv_enabled`.
--
-- No modo copilot, a tool grava o resultado em `copilot_suggestions`
-- (próxima migration) e retorna pra Bia um texto-promessa curto tipo
-- "já vou puxar os números com o consultor". Corretor revisa no inbox,
-- edita se quiser, e envia.

INSERT INTO system_settings (key, value, description) VALUES
  ('finance_simulate_mode', 'copilot',
   'Modo de entrega de simulate_financing. "copilot" (default): Bia grava sugestão, corretor revisa e envia. "direct": Bia envia os números direto ao lead (só habilitar quando admin confiar nas taxas cadastradas). Ignorado se finance_simulate_enabled=false.'),
  ('finance_mcmv_mode', 'copilot',
   'Modo de entrega de check_mcmv. "copilot" (default) ou "direct". MCMV é menos arriscado que simulação (faixas são públicas) mas "primeiro imóvel" tem definição legal que vale confirmar com humano. Ignorado se finance_mcmv_enabled=false.')
ON CONFLICT (key) DO NOTHING;
