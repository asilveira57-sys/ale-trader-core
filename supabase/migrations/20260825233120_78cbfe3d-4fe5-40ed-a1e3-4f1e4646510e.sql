ALTER TABLE public.b3_simulation_mode_settings
  DROP CONSTRAINT b3_simulation_mode_settings_entry_style_check;

ALTER TABLE public.b3_simulation_mode_settings
  ADD CONSTRAINT b3_simulation_mode_settings_entry_style_check
  CHECK (entry_style = ANY (ARRAY['indicador'::text, 'price_action'::text, 'mean_reversion'::text, 'range'::text, 'rompimento'::text]));

ALTER TABLE public.b3_simulation_orders ADD COLUMN IF NOT EXISTS stop_pts numeric;
ALTER TABLE public.b3_simulation_orders ADD COLUMN IF NOT EXISTS gain_pts numeric;

COMMENT ON COLUMN public.b3_simulation_orders.stop_pts IS 'Stop da ordem em pontos quando definido pelo classificador de entrada (ex.: rompimento = 0,45 x altura do canal). Vazio = usa stop_pts da configuracao do modo.';
COMMENT ON COLUMN public.b3_simulation_orders.gain_pts IS 'Alvo da ordem em pontos quando definido pelo classificador de entrada (ex.: rompimento = 1,0 x altura do canal). Vazio = usa gain_pts da configuracao do modo.';