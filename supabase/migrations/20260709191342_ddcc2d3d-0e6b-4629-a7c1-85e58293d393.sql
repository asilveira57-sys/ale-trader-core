
-- 1) Engine selector on b3_mt5sim_settings
ALTER TABLE public.b3_mt5sim_settings
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'legacy_b3';

-- 2) M1 candles aggregated from MT5 ticks
CREATE TABLE IF NOT EXISTS public.b3_legacy_mt5_candles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  minute_ts TIMESTAMPTZ NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC NOT NULL DEFAULT 0,
  tick_count INTEGER NOT NULL DEFAULT 0,
  server TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, minute_ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_legacy_mt5_candles TO authenticated;
GRANT ALL ON public.b3_legacy_mt5_candles TO service_role;
ALTER TABLE public.b3_legacy_mt5_candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own candles" ON public.b3_legacy_mt5_candles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_legacy_candles_user_sym_ts ON public.b3_legacy_mt5_candles(user_id, symbol, minute_ts DESC);

-- 3) Signals produced by the legacy engine over MT5 data
CREATE TABLE IF NOT EXISTS public.b3_legacy_mt5_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  intended_side TEXT NOT NULL,
  decision TEXT NOT NULL,
  score NUMERIC,
  price_bid NUMERIC,
  price_ask NUMERIC,
  price_last NUMERIC,
  spread NUMERIC,
  tick_age_s NUMERIC,
  server TEXT,
  reason TEXT,
  blocked_reason TEXT,
  votes JSONB
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_legacy_mt5_signals TO authenticated;
GRANT ALL ON public.b3_legacy_mt5_signals TO service_role;
ALTER TABLE public.b3_legacy_mt5_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own legacy signals" ON public.b3_legacy_mt5_signals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_legacy_signals_user_ts ON public.b3_legacy_mt5_signals(user_id, ts DESC);

-- 4) Simulated trades executed by the legacy engine over MT5 quotes (WINQ26)
CREATE TABLE IF NOT EXISTS public.b3_legacy_mt5_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  entry_price NUMERIC NOT NULL,
  entry_bid NUMERIC,
  entry_ask NUMERIC,
  exit_price NUMERIC,
  exit_bid NUMERIC,
  exit_ask NUMERIC,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  stop_pts NUMERIC,
  gain_pts NUMERIC,
  slippage_pts NUMERIC DEFAULT 0,
  fees_brl NUMERIC DEFAULT 0,
  gross_pts NUMERIC,
  gross_brl NUMERIC,
  net_brl NUMERIC,
  status TEXT NOT NULL DEFAULT 'open',
  close_reason TEXT,
  quote_server TEXT,
  source_engine TEXT NOT NULL DEFAULT 'legacy_b3',
  legacy_signal_id UUID,
  legacy_mode_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_legacy_mt5_trades TO authenticated;
GRANT ALL ON public.b3_legacy_mt5_trades TO service_role;
ALTER TABLE public.b3_legacy_mt5_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own legacy trades" ON public.b3_legacy_mt5_trades FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_legacy_trades_user_opened ON public.b3_legacy_mt5_trades(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_trades_user_status ON public.b3_legacy_mt5_trades(user_id, status);
