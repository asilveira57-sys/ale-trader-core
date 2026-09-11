ALTER TABLE public.b3_grupo_sombra_dia
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT '';

ALTER TABLE public.b3_grupo_sombra_dia
  DROP CONSTRAINT IF EXISTS b3_grupo_sombra_dia_user_id_symbol_variant_trade_date_key;

DROP INDEX IF EXISTS public.b3_grupo_sombra_dia_uk;

CREATE UNIQUE INDEX IF NOT EXISTS b3_grupo_sombra_dia_uk
  ON public.b3_grupo_sombra_dia (user_id, symbol, variant, mode, trade_date);