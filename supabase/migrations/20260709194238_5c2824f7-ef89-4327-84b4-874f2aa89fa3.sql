ALTER TABLE public.b3_trading_settings
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'csv';
ALTER TABLE public.b3_trading_settings
  ADD CONSTRAINT b3_trading_settings_price_source_chk
  CHECK (price_source IN ('csv','mt5_xp_demo'));