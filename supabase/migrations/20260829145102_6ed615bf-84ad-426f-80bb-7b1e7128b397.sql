ALTER TABLE public.b3_simulation_modes DROP CONSTRAINT IF EXISTS b3_simulation_modes_mode_check;
ALTER TABLE public.b3_simulation_modes ADD CONSTRAINT b3_simulation_modes_mode_check
  CHECK (mode = ANY (ARRAY['conservador','cauteloso','moderado','equilibrado','semi_agressivo','arrojado','agressivo']::text[]));

ALTER TABLE public.b3_simulation_mode_settings DROP CONSTRAINT IF EXISTS b3_simulation_mode_settings_mode_check;
ALTER TABLE public.b3_simulation_mode_settings ADD CONSTRAINT b3_simulation_mode_settings_mode_check
  CHECK (mode = ANY (ARRAY['conservador','cauteloso','moderado','equilibrado','semi_agressivo','arrojado','agressivo']::text[]));

ALTER TABLE public.b3_mt5sim_robots DROP CONSTRAINT IF EXISTS b3_mt5sim_robots_profile_check;
ALTER TABLE public.b3_mt5sim_robots ADD CONSTRAINT b3_mt5sim_robots_profile_check
  CHECK (profile = ANY (ARRAY['conservador','cauteloso','moderado','equilibrado','semi_agressivo','arrojado','agressivo']::text[]));

ALTER TABLE public.b3_mode_user_defaults DROP CONSTRAINT IF EXISTS b3_mode_user_defaults_mode_check;
ALTER TABLE public.b3_mode_user_defaults ADD CONSTRAINT b3_mode_user_defaults_mode_check
  CHECK (mode = ANY (ARRAY['conservador','cauteloso','moderado','equilibrado','semi_agressivo','arrojado','agressivo']::text[]));

ALTER TABLE public.b3_prd_authorizations DROP CONSTRAINT IF EXISTS b3_prd_auth_modo_valido;
ALTER TABLE public.b3_prd_authorizations ADD CONSTRAINT b3_prd_auth_modo_valido
  CHECK (mode = ANY (ARRAY['conservador','cauteloso','moderado','equilibrado','semi_agressivo','arrojado','agressivo']::text[]));