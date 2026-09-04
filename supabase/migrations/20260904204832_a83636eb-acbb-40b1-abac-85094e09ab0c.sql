ALTER TABLE public.b3_asset_profiles
  ADD COLUMN IF NOT EXISTS vwap_min_distance_stop_ratio numeric NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS vwap_min_distance_range_ratio numeric NOT NULL DEFAULT 0.25;

COMMENT ON COLUMN public.b3_asset_profiles.vwap_min_distance_stop_ratio IS
  'Modalidade vwap: limiar de afastamento minimo = stop_pts * este multiplicador. Padrao 0.8 = valor historico embutido no motor.';
COMMENT ON COLUMN public.b3_asset_profiles.vwap_min_distance_range_ratio IS
  'Modalidade vwap: limiar de afastamento minimo = amplitude do dia * esta fracao. Vale o maior entre os dois. Padrao 0.25 = valor historico embutido no motor.';