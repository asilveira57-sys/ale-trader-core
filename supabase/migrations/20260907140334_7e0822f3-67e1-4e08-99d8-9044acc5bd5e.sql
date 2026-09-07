ALTER TABLE public.b3_real_account_peak
  ADD COLUMN IF NOT EXISTS circuit_gain_latched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS circuit_gain_latched_at timestamptz,
  ADD COLUMN IF NOT EXISTS circuit_gain_latched_result_brl numeric,
  ADD COLUMN IF NOT EXISTS circuit_gain_latched_open integer;