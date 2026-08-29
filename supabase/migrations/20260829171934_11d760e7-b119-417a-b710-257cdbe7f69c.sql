ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS breakeven_ativa_pts numeric,
  ADD COLUMN IF NOT EXISTS breakeven_folga_pts numeric;

COMMENT ON COLUMN public.b3_simulation_mode_settings.breakeven_ativa_pts IS 'Pontos a favor a partir dos quais o stop vai para o preco de entrada (zero a zero). NULL ou 0 = desligado.';
COMMENT ON COLUMN public.b3_simulation_mode_settings.breakeven_folga_pts IS 'Folga em pontos acima (compra) ou abaixo (venda) do preco de entrada usada como nivel de zero a zero.';