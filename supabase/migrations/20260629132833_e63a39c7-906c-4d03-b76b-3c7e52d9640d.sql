
ALTER TABLE public.binance_audit_learning
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS motivos jsonb,
  ADD COLUMN IF NOT EXISTS recovery_lost_pct numeric,
  ADD COLUMN IF NOT EXISTS recovery_lost_usdt numeric,
  ADD COLUMN IF NOT EXISTS indicators jsonb,
  ADD COLUMN IF NOT EXISTS recommendation text,
  ADD COLUMN IF NOT EXISTS position_size numeric,
  ADD COLUMN IF NOT EXISTS pattern_key text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid;

CREATE INDEX IF NOT EXISTS idx_bal_pattern ON public.binance_audit_learning(pattern_key);
CREATE INDEX IF NOT EXISTS idx_bal_dup ON public.binance_audit_learning(duplicate_of);
