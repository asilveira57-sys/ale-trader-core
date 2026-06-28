
CREATE TABLE IF NOT EXISTS public.binance_audit_learning (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  trade_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  exit_price NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  high_1h NUMERIC, low_1h NUMERIC,
  high_4h NUMERIC, low_4h NUMERIC,
  high_12h NUMERIC, low_12h NUMERIC,
  high_24h NUMERIC, low_24h NUMERIC,
  recovery_1h NUMERIC, recovery_4h NUMERIC, recovery_12h NUMERIC, recovery_24h NUMERIC,
  recovery_max NUMERIC,
  drawdown_avoided NUMERIC,
  classification TEXT,
  diagnosis TEXT,
  avoidable BOOLEAN DEFAULT false,
  premature BOOLEAN DEFAULT false,
  score NUMERIC,
  candles_available BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, trade_id)
);
GRANT SELECT ON public.binance_audit_learning TO authenticated;
GRANT ALL ON public.binance_audit_learning TO service_role;
ALTER TABLE public.binance_audit_learning ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read binance_audit_learning" ON public.binance_audit_learning
  FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_bal_symbol_exit ON public.binance_audit_learning(symbol, exit_time DESC);
CREATE INDEX IF NOT EXISTS idx_bal_classification ON public.binance_audit_learning(classification);
CREATE INDEX IF NOT EXISTS idx_bal_candles ON public.binance_audit_learning(candles_available);
CREATE TRIGGER trg_bal_touch BEFORE UPDATE ON public.binance_audit_learning
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
