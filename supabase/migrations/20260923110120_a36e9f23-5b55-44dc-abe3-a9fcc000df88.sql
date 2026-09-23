ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS confirmacao_ativa_simulado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmacao_ativa_real boolean NOT NULL DEFAULT false;

UPDATE public.b3_simulation_mode_settings
   SET confirmacao_ativa_simulado = true, confirmacao_ativa_real = true
 WHERE confirmacao_ativa = true;

ALTER TABLE public.b3_simulation_mode_settings DROP COLUMN IF EXISTS confirmacao_ativa;