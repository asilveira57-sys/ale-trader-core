CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_quotes_user_symbol_tick_ts_desc
  ON public.b3_mt5sim_quotes (user_id, symbol, tick_ts DESC);

CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_quotes_user_symbol_received_at_desc
  ON public.b3_mt5sim_quotes (user_id, symbol, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_trades_user_ts_entry_desc
  ON public.b3_mt5sim_trades (user_id, ts_entry DESC);

CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_blocks_user_ts_desc
  ON public.b3_mt5sim_blocks (user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_conflicts_user_ts_desc
  ON public.b3_mt5sim_conflicts (user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_order_attempts_user_ts_desc
  ON public.b3_mt5sim_order_attempts (user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_b3_simulation_runs_user_symbol_session_started_desc
  ON public.b3_simulation_runs (user_id, symbol, session_date, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_b3_simulation_modes_run_user_mode
  ON public.b3_simulation_modes (simulation_run_id, user_id, mode);

CREATE INDEX IF NOT EXISTS idx_b3_simulation_orders_run_user_created_desc
  ON public.b3_simulation_orders (simulation_run_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_b3_simulation_orders_run_user_mode_status
  ON public.b3_simulation_orders (simulation_run_id, user_id, mode, status);

CREATE INDEX IF NOT EXISTS idx_b3_simulation_market_snapshots_run_user_time_desc
  ON public.b3_simulation_market_snapshots (simulation_run_id, user_id, market_time DESC);

CREATE INDEX IF NOT EXISTS idx_b3_simulation_block_events_run_user_occurred_desc
  ON public.b3_simulation_block_events (simulation_run_id, user_id, occurred_at DESC);