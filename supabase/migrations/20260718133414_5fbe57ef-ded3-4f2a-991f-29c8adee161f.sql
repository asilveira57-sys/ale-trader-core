ALTER TABLE public.b3_mt5sim_robots
  ADD COLUMN IF NOT EXISTS exit_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS breakeven_trigger_pts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trailing_start_pts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trailing_step_pts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_duration_s integer NOT NULL DEFAULT 0;

ALTER TABLE public.b3_mt5sim_robots
  DROP CONSTRAINT IF EXISTS b3_mt5sim_robots_exit_mode_check;
ALTER TABLE public.b3_mt5sim_robots
  ADD CONSTRAINT b3_mt5sim_robots_exit_mode_check
  CHECK (exit_mode IN ('fixed','breakeven','trailing','loss_of_momentum','time_based','session_close'));

ALTER TABLE public.b3_mt5sim_trades
  ADD COLUMN IF NOT EXISTS trailing_stop_price numeric,
  ADD COLUMN IF NOT EXISTS breakeven_active boolean NOT NULL DEFAULT false;