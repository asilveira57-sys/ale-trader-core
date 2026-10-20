ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN pa_eficiencia_min numeric DEFAULT 0.30,
  ADD COLUMN pa_posicao_max_compra numeric DEFAULT 0.65,
  ADD COLUMN pa_posicao_min_venda numeric DEFAULT 0.35,
  ADD COLUMN pa_geometria_ativa boolean DEFAULT true;