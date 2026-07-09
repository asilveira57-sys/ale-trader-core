
ALTER TABLE public.b3_mt5sim_robots
  ADD COLUMN IF NOT EXISTS stop_loss_points numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS take_profit_points numeric NOT NULL DEFAULT 200;

ALTER TABLE public.b3_mt5sim_trades
  ADD COLUMN IF NOT EXISTS stop_price numeric,
  ADD COLUMN IF NOT EXISTS target_price numeric;
