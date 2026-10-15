ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS pa_estrutura_modo text NOT NULL DEFAULT 'dow_estrito',
  ADD COLUMN IF NOT EXISTS pa_min_swings integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pa_near_struct_mult numeric NOT NULL DEFAULT 0.6,
  ADD COLUMN IF NOT EXISTS pa_near_struct_piso_pts numeric NOT NULL DEFAULT 20;
ALTER TABLE public.b3_simulation_mode_settings
  ADD CONSTRAINT b3_sms_pa_estrutura_modo_chk CHECK (pa_estrutura_modo IN ('dow_estrito','dow_lado','desligado'));