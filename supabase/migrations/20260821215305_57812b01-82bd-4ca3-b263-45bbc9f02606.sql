ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS peak_giveback_pct numeric NOT NULL DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS peak_lock_min_profit_brl numeric;

ALTER TABLE public.b3_simulation_modes
  ADD COLUMN IF NOT EXISTS day_peak_profit_brl numeric NOT NULL DEFAULT 0;