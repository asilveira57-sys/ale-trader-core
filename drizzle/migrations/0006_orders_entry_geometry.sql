ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS geo_eficiencia_direcional numeric,
  ADD COLUMN IF NOT EXISTS geo_posicao_na_faixa numeric,
  ADD COLUMN IF NOT EXISTS geo_amplitude_pts numeric,
  ADD COLUMN IF NOT EXISTS geo_velas integer,
  ADD COLUMN IF NOT EXISTS geo_veredito text,
  ADD COLUMN IF NOT EXISTS agentes_votos jsonb;