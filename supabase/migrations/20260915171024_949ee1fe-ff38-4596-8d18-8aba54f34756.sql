ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS freios_na_sombra text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.b3_grupo_sombra_dia
  ADD COLUMN IF NOT EXISTS sombra_por_freio jsonb NOT NULL DEFAULT '{}'::jsonb;