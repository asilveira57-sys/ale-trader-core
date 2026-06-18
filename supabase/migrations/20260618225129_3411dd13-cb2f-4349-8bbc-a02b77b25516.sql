
-- Trigger reutilizável já existe (touch_updated_at), vamos reaproveitar.

-- 1) b3_simulation_runs
CREATE TABLE public.b3_simulation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','finished','cancelled')),
  initial_balance NUMERIC NOT NULL DEFAULT 10000,
  market_source TEXT NOT NULL DEFAULT 'mock',
  trading_start_time TEXT NOT NULL DEFAULT '09:15',
  entry_cutoff_time TEXT NOT NULL DEFAULT '16:30',
  force_close_time TEXT NOT NULL DEFAULT '16:55',
  start_date DATE,
  end_date DATE,
  max_contracts INTEGER NOT NULL DEFAULT 1,
  simulated_fee_brl NUMERIC NOT NULL DEFAULT 1.5,
  simulated_slippage_pts NUMERIC NOT NULL DEFAULT 0,
  winner_mode TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_simulation_runs TO authenticated;
GRANT ALL ON public.b3_simulation_runs TO service_role;
ALTER TABLE public.b3_simulation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own b3_simulation_runs" ON public.b3_simulation_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_simulation_runs_upd BEFORE UPDATE ON public.b3_simulation_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) b3_simulation_modes
CREATE TABLE public.b3_simulation_modes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  simulation_run_id UUID NOT NULL REFERENCES public.b3_simulation_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('conservador','moderado','agressivo')),
  initial_balance NUMERIC NOT NULL DEFAULT 10000,
  current_balance NUMERIC NOT NULL DEFAULT 10000,
  realized_pnl NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
  total_fees NUMERIC NOT NULL DEFAULT 0,
  total_trades INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  losing_trades INTEGER NOT NULL DEFAULT 0,
  max_drawdown NUMERIC NOT NULL DEFAULT 0,
  max_gain NUMERIC NOT NULL DEFAULT 0,
  max_loss NUMERIC NOT NULL DEFAULT 0,
  points_result NUMERIC NOT NULL DEFAULT 0,
  contracts_traded INTEGER NOT NULL DEFAULT 0,
  risk_blocks INTEGER NOT NULL DEFAULT 0,
  committee_approvals INTEGER NOT NULL DEFAULT 0,
  committee_rejections INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (simulation_run_id, mode)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_simulation_modes TO authenticated;
GRANT ALL ON public.b3_simulation_modes TO service_role;
ALTER TABLE public.b3_simulation_modes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own b3_simulation_modes" ON public.b3_simulation_modes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_simulation_modes_upd BEFORE UPDATE ON public.b3_simulation_modes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) b3_simulation_orders
CREATE TABLE public.b3_simulation_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  simulation_run_id UUID NOT NULL REFERENCES public.b3_simulation_runs(id) ON DELETE CASCADE,
  simulation_mode_id UUID NOT NULL REFERENCES public.b3_simulation_modes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  symbol TEXT NOT NULL DEFAULT 'WIN',
  contract_code TEXT NOT NULL DEFAULT 'WINFUT',
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  quantity INTEGER NOT NULL DEFAULT 1,
  entry_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_time TIMESTAMPTZ,
  gross_result_points NUMERIC NOT NULL DEFAULT 0,
  gross_result_brl NUMERIC NOT NULL DEFAULT 0,
  fees NUMERIC NOT NULL DEFAULT 0,
  net_result_brl NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_simulation_orders TO authenticated;
GRANT ALL ON public.b3_simulation_orders TO service_role;
ALTER TABLE public.b3_simulation_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own b3_simulation_orders" ON public.b3_simulation_orders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_simulation_orders_upd BEFORE UPDATE ON public.b3_simulation_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_b3_sim_orders_run ON public.b3_simulation_orders(simulation_run_id);
CREATE INDEX idx_b3_sim_orders_mode ON public.b3_simulation_orders(simulation_mode_id);

-- 4) b3_simulation_agent_votes
CREATE TABLE public.b3_simulation_agent_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  simulation_run_id UUID NOT NULL REFERENCES public.b3_simulation_runs(id) ON DELETE CASCADE,
  simulation_mode_id UUID NOT NULL REFERENCES public.b3_simulation_modes(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.b3_simulation_orders(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  vote TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  market_data_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_simulation_agent_votes TO authenticated;
GRANT ALL ON public.b3_simulation_agent_votes TO service_role;
ALTER TABLE public.b3_simulation_agent_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own b3_simulation_agent_votes" ON public.b3_simulation_agent_votes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_sim_votes_run ON public.b3_simulation_agent_votes(simulation_run_id);
CREATE INDEX idx_b3_sim_votes_mode ON public.b3_simulation_agent_votes(simulation_mode_id);

-- 5) b3_simulation_market_snapshots
CREATE TABLE public.b3_simulation_market_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  simulation_run_id UUID NOT NULL REFERENCES public.b3_simulation_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL DEFAULT 'WIN',
  price NUMERIC NOT NULL,
  candle_open NUMERIC,
  candle_high NUMERIC,
  candle_low NUMERIC,
  candle_close NUMERIC,
  volume NUMERIC,
  vwap NUMERIC,
  market_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'mock',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_simulation_market_snapshots TO authenticated;
GRANT ALL ON public.b3_simulation_market_snapshots TO service_role;
ALTER TABLE public.b3_simulation_market_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own b3_simulation_market_snapshots" ON public.b3_simulation_market_snapshots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_sim_snap_run ON public.b3_simulation_market_snapshots(simulation_run_id);

-- 6) b3_macro_events
CREATE TABLE public.b3_macro_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'macro',
  block_start TIMESTAMPTZ NOT NULL,
  block_end TIMESTAMPTZ NOT NULL,
  severity TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('low','medium','high')),
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_macro_events TO authenticated;
GRANT ALL ON public.b3_macro_events TO service_role;
ALTER TABLE public.b3_macro_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own b3_macro_events" ON public.b3_macro_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_macro_events_upd BEFORE UPDATE ON public.b3_macro_events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_b3_macro_events_window ON public.b3_macro_events(user_id, block_start, block_end);
