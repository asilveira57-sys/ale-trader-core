ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS confirmacao_exigida_pts numeric,
  ADD COLUMN IF NOT EXISTS confirmacao_janela_s integer,
  ADD COLUMN IF NOT EXISTS confirmou boolean,
  ADD COLUMN IF NOT EXISTS confirmou_em timestamptz,
  ADD COLUMN IF NOT EXISTS preco_confirmacao numeric,
  ADD COLUMN IF NOT EXISTS stop_recalculado numeric,
  ADD COLUMN IF NOT EXISTS alvo_recalculado numeric;

COMMENT ON COLUMN public.b3_simulation_orders.confirmacao_exigida_pts IS
  'Sombra: pontos a favor exigidos para confirmar a entrada (percentual do stop do robo). Registro, nunca bloqueia.';
COMMENT ON COLUMN public.b3_simulation_orders.stop_recalculado IS
  'Sombra: onde o stop ficaria se a entrada fosse no preco de confirmacao. Registro, nao aplicado.';

ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS confirmacao_ativa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmacao_pct_stop numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS confirmacao_janela_s integer NOT NULL DEFAULT 180;