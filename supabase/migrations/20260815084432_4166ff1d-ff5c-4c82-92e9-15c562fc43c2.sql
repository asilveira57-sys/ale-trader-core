ALTER TABLE public.b3_trading_settings
  ADD COLUMN IF NOT EXISTS global_daily_loss_limit_brl numeric NOT NULL DEFAULT 1000;

ALTER TABLE public.b3_prd_authorizations
  DROP CONSTRAINT IF EXISTS b3_prd_auth_unico;

ALTER TABLE public.b3_prd_authorizations
  ADD CONSTRAINT b3_prd_auth_unico UNIQUE (user_id, symbol, variant, mode);