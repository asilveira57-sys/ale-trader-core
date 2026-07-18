
ALTER TABLE public.b3_mt5sim_settings
  ADD COLUMN IF NOT EXISTS min_risk_reward numeric NOT NULL DEFAULT 1.2,
  ADD COLUMN IF NOT EXISTS max_tick_age_seconds integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_tick_jump_pts integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS slippage_ticks_entry integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slippage_ticks_exit integer NOT NULL DEFAULT 0;

ALTER TABLE public.b3_mt5sim_trades
  ADD COLUMN IF NOT EXISTS mfe_pts numeric,
  ADD COLUMN IF NOT EXISTS mae_pts numeric,
  ADD COLUMN IF NOT EXISTS mfe_brl numeric,
  ADD COLUMN IF NOT EXISTS mae_brl numeric,
  ADD COLUMN IF NOT EXISTS best_price numeric,
  ADD COLUMN IF NOT EXISTS worst_price numeric,
  ADD COLUMN IF NOT EXISTS duration_s integer,
  ADD COLUMN IF NOT EXISTS initial_risk_brl numeric,
  ADD COLUMN IF NOT EXISTS initial_target_brl numeric,
  ADD COLUMN IF NOT EXISTS max_open_profit_brl numeric,
  ADD COLUMN IF NOT EXISTS exit_reason_detail text,
  ADD COLUMN IF NOT EXISTS tick_age_entry_s numeric,
  ADD COLUMN IF NOT EXISTS tick_age_exit_s numeric,
  ADD COLUMN IF NOT EXISTS spread_entry_ticks numeric,
  ADD COLUMN IF NOT EXISTS spread_exit_ticks numeric,
  ADD COLUMN IF NOT EXISTS risk_reward_ratio numeric;

ALTER TABLE public.b3_mt5sim_signals
  ADD COLUMN IF NOT EXISTS signal_hash text;

CREATE INDEX IF NOT EXISTS idx_b3_mt5sim_signals_hash
  ON public.b3_mt5sim_signals (user_id, signal_hash);

ALTER TABLE public.b3_mt5sim_runs
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tick_price numeric;
