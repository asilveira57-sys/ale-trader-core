ALTER TABLE public.b3_trading_settings
  ADD COLUMN IF NOT EXISTS mt5_guard_mode text NOT NULL DEFAULT 'validation',
  ADD COLUMN IF NOT EXISTS mt5_tick_ttl_seconds integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS mt5_tick_ttl_tolerance_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS mt5_spread_max_points integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS mt5_price_deviation_limit integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS mt5_require_nonzero_volume boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mt5_require_nonzero_last boolean NOT NULL DEFAULT false;