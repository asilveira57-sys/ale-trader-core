ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS diagnostic_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_eval_minute_ts timestamptz;