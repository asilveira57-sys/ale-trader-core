ALTER TABLE public.b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS lateral_strength_min numeric;
ALTER TABLE public.b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS lateral_vol_min numeric;