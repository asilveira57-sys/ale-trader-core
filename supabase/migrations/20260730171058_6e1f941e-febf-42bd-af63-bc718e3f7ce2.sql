CREATE INDEX IF NOT EXISTS idx_b3_sim_snapshots_user_time_desc
  ON public.b3_simulation_market_snapshots USING btree (user_id, market_time DESC);