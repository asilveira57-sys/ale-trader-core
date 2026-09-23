ALTER TABLE public.b3_simulation_modes
  ADD COLUMN IF NOT EXISTS confirmacao_pendente jsonb;

COMMENT ON COLUMN public.b3_simulation_modes.confirmacao_pendente IS
  'Sinal aguardando confirmação de preço quando a regra de confirmação está ligada para o robô. Nulo = nada aguardando.';