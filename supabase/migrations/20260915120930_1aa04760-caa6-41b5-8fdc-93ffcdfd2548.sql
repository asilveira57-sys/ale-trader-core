-- Ordens legadas (fonte de preço diferente de MT5 XP DEMO/B3QuoteProvider):
-- o filtro passa a ser feito no banco, com índice parcial. Quase sempre vazio.
CREATE INDEX IF NOT EXISTS idx_b3_sim_orders_legacy_pending
  ON public.b3_simulation_orders (simulation_run_id, user_id)
  WHERE status IN ('open', 'closed')
    AND (quote_source IS DISTINCT FROM 'MT5 XP DEMO'
      OR provider_name IS DISTINCT FROM 'B3QuoteProvider');

-- Recálculo de totais por modo: só ordens válidas MT5 da execução.
CREATE INDEX IF NOT EXISTS idx_b3_sim_orders_valid_mt5
  ON public.b3_simulation_orders (simulation_run_id, user_id, mode)
  WHERE quote_source = 'MT5 XP DEMO' AND provider_name = 'B3QuoteProvider';

-- Voto do comitê: campos próprios no lugar do JSON repetido por agente.
-- O contexto de mercado do tique vive em public.b3_engine_state (engine_audit),
-- uma linha por execução, ligado por tick_snapshot_id.
ALTER TABLE public.b3_simulation_agent_votes
  ADD COLUMN IF NOT EXISTS tick_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS side text,
  ADD COLUMN IF NOT EXISTS has_veto boolean,
  ADD COLUMN IF NOT EXISTS veto_reason text;

COMMENT ON COLUMN public.b3_simulation_agent_votes.market_data_snapshot IS
  'Legado: linhas até 15/09/2026 traziam o contexto do tique aqui. A partir daí o contexto fica em b3_simulation_market_snapshots / b3_engine_state (ligado por tick_snapshot_id) e a linha do agente guarda apenas decision, score, side, has_veto e veto_reason.';