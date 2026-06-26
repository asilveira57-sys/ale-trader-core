-- Brain audit: registra cada análise multitemporal com score, votos por indicador, taxas e lucro líquido esperado
CREATE TABLE public.binance_brain_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell','hold','skip')),
  price NUMERIC NOT NULL,
  qty NUMERIC,
  notional NUMERIC,
  -- multitemporal
  trend_1m TEXT, trend_5m TEXT, trend_15m TEXT, trend_1h TEXT, trend_4h TEXT, trend_1d TEXT, trend_7d TEXT, trend_15d TEXT, trend_30d TEXT,
  dominant_trend TEXT,
  timeframe_conflict BOOLEAN DEFAULT false,
  -- indicadores (votos: 'approve' | 'reject' | 'neutral')
  indicator_votes JSONB NOT NULL DEFAULT '{}'::jsonb,
  approve_count INT DEFAULT 0,
  reject_count INT DEFAULT 0,
  neutral_count INT DEFAULT 0,
  -- score
  score NUMERIC NOT NULL DEFAULT 0,
  classification TEXT,
  -- taxas
  fee_buy NUMERIC DEFAULT 0,
  fee_sell NUMERIC DEFAULT 0,
  spread_pct NUMERIC DEFAULT 0,
  slippage_pct NUMERIC DEFAULT 0,
  expected_gross NUMERIC DEFAULT 0,
  expected_net NUMERIC DEFAULT 0,
  fee_gate_passed BOOLEAN DEFAULT false,
  -- contexto
  volatility_class TEXT,
  volume_signal TEXT,
  fib_levels JSONB,
  rationale TEXT,
  -- decisão final do cérebro
  brain_recommendation TEXT NOT NULL,
  flex_mode BOOLEAN DEFAULT false,
  sample_size INT DEFAULT 0,
  -- linkagem opcional ao trade executado
  related_decision_id UUID,
  related_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.binance_brain_audit TO authenticated;
GRANT ALL ON public.binance_brain_audit TO service_role;
ALTER TABLE public.binance_brain_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads brain audit" ON public.binance_brain_audit
  FOR SELECT TO authenticated USING (public.is_owner());

CREATE INDEX idx_brain_audit_created ON public.binance_brain_audit(created_at DESC);
CREATE INDEX idx_brain_audit_symbol ON public.binance_brain_audit(symbol, created_at DESC);

-- Performance acumulada por indicador (para ranking de assertividade)
CREATE TABLE public.binance_indicator_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  indicator TEXT NOT NULL UNIQUE,
  votes_total INT DEFAULT 0,
  votes_approve INT DEFAULT 0,
  votes_reject INT DEFAULT 0,
  hits INT DEFAULT 0,
  misses INT DEFAULT 0,
  hit_rate NUMERIC DEFAULT 0,
  weight NUMERIC DEFAULT 1.0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.binance_indicator_performance TO authenticated;
GRANT ALL ON public.binance_indicator_performance TO service_role;
ALTER TABLE public.binance_indicator_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads indicator perf" ON public.binance_indicator_performance
  FOR SELECT TO authenticated USING (public.is_owner());