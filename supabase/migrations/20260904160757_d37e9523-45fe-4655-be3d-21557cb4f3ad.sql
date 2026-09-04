ALTER TABLE public.b3_real_execution_state
  ADD COLUMN IF NOT EXISTS daily_circuit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_gain_target_pct numeric NOT NULL DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS daily_loss_cap_pct numeric NOT NULL DEFAULT 0.25;

ALTER TABLE public.b3_real_account_peak
  ADD COLUMN IF NOT EXISTS circuit_armed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS circuit_kind text,
  ADD COLUMN IF NOT EXISTS circuit_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS circuit_base_brl numeric,
  ADD COLUMN IF NOT EXISTS circuit_result_brl numeric,
  ADD COLUMN IF NOT EXISTS circuit_robots integer;