ALTER TABLE public.b3_trading_settings
  ADD COLUMN IF NOT EXISTS capital_disponivel_brl numeric NOT NULL DEFAULT 0;