ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS entry_score numeric,
  ADD COLUMN IF NOT EXISTS entry_confidence numeric,
  ADD COLUMN IF NOT EXISTS entry_approve_votes integer,
  ADD COLUMN IF NOT EXISTS entry_setup text;

CREATE INDEX IF NOT EXISTS idx_b3_sim_votes_order_id
  ON public.b3_simulation_agent_votes (order_id)
  WHERE order_id IS NOT NULL;