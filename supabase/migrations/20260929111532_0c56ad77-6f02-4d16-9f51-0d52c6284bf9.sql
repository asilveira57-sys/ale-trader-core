ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS limites_proporcionais boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS peak_lock_min_profit_pct numeric,
  ADD COLUMN IF NOT EXISTS daily_gain_target_pct numeric,
  ADD COLUMN IF NOT EXISTS daily_loss_limit_pct numeric,
  ADD COLUMN IF NOT EXISTS risco_contratos_pct numeric,
  ADD COLUMN IF NOT EXISTS trailing_activation_pct_stop numeric,
  ADD COLUMN IF NOT EXISTS trailing_giveback_pct_stop numeric,
  ADD COLUMN IF NOT EXISTS breakeven_ativa_pct_stop numeric,
  ADD COLUMN IF NOT EXISTS breakeven_folga_pct_stop numeric,
  ADD COLUMN IF NOT EXISTS proporcional_capital_ref_brl numeric;
ALTER TABLE public.b3_mt5_account_state
  ADD COLUMN IF NOT EXISTS capital_aceito numeric,
  ADD COLUMN IF NOT EXISTS capital_pendente numeric,
  ADD COLUMN IF NOT EXISTS capital_pendente_leituras integer NOT NULL DEFAULT 0;