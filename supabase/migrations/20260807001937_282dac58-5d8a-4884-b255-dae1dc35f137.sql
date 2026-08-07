ALTER TABLE public.b3_simulation_mode_settings
  ALTER COLUMN stop_pts TYPE numeric(12,4),
  ALTER COLUMN gain_pts TYPE numeric(12,4);

ALTER TABLE public.b3_asset_profiles
  ADD COLUMN IF NOT EXISTS spread_max_price numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS price_deviation_limit numeric NOT NULL DEFAULT 2000;

UPDATE public.b3_asset_profiles SET spread_max_price = 15,   price_deviation_limit = 2000 WHERE symbol = 'WINQ26';
UPDATE public.b3_asset_profiles SET spread_max_price = 2.0,  price_deviation_limit = 50   WHERE symbol = 'WDOU26';
UPDATE public.b3_asset_profiles SET spread_max_price = 0.02, price_deviation_limit = 1.00 WHERE symbol = 'PETR4';
UPDATE public.b3_asset_profiles SET spread_max_price = 0.03, price_deviation_limit = 2.00 WHERE symbol = 'VALE3';