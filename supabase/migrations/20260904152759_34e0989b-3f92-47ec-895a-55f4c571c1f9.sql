ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS mfe_pts numeric,
  ADD COLUMN IF NOT EXISTS mae_pts numeric;