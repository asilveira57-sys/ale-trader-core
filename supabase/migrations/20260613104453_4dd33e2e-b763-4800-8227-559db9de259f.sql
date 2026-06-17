
-- Extend robot_settings with risk + mode controls
ALTER TABLE public.robot_settings
  ADD COLUMN IF NOT EXISTS max_per_trade numeric DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_per_asset numeric DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS max_portfolio_exposure numeric DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS daily_loss_limit numeric DEFAULT 200,
  ADD COLUMN IF NOT EXISTS weekly_loss_limit numeric DEFAULT 800,
  ADD COLUMN IF NOT EXISTS monthly_loss_limit numeric DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS max_loss_streak integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS default_stop_pct numeric DEFAULT 3,
  ADD COLUMN IF NOT EXISTS default_take_pct numeric DEFAULT 6,
  ADD COLUMN IF NOT EXISTS alerts_telegram_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerts_whatsapp_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS phase_ready boolean DEFAULT false;

-- 1. trading_sessions
CREATE TABLE IF NOT EXISTS public.trading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('reading','simulation','testnet')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','halted','stopped')),
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  initial_balance numeric NOT NULL DEFAULT 10000,
  current_balance numeric NOT NULL DEFAULT 10000,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trading_sessions TO authenticated;
GRANT ALL ON public.trading_sessions TO service_role;
ALTER TABLE public.trading_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_trading_sessions" ON public.trading_sessions FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_trading_sessions_touch BEFORE UPDATE ON public.trading_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. live_simulated_positions
CREATE TABLE IF NOT EXISTS public.live_simulated_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trading_sessions(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.monitored_assets(id) ON DELETE SET NULL,
  pair text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  qty numeric NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_time timestamptz,
  exit_price numeric,
  exit_reason text,
  pnl numeric DEFAULT 0,
  pnl_pct numeric DEFAULT 0,
  decision_id uuid REFERENCES public.committee_decisions(id) ON DELETE SET NULL,
  last_price numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_simulated_positions TO authenticated;
GRANT ALL ON public.live_simulated_positions TO service_role;
ALTER TABLE public.live_simulated_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_live_positions" ON public.live_simulated_positions FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX IF NOT EXISTS idx_live_pos_session ON public.live_simulated_positions(session_id, status);
CREATE TRIGGER trg_live_pos_touch BEFORE UPDATE ON public.live_simulated_positions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. testnet_orders
CREATE TABLE IF NOT EXISTS public.testnet_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trading_sessions(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.monitored_assets(id) ON DELETE SET NULL,
  pair text NOT NULL,
  side text NOT NULL,
  type text NOT NULL DEFAULT 'MARKET',
  qty numeric NOT NULL,
  price numeric,
  stop_loss numeric,
  take_profit numeric,
  binance_order_id text,
  binance_status text,
  raw_response jsonb,
  pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.testnet_orders TO authenticated;
GRANT ALL ON public.testnet_orders TO service_role;
ALTER TABLE public.testnet_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_testnet_orders" ON public.testnet_orders FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- 4. reputation_history
CREATE TABLE IF NOT EXISTS public.reputation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  hit_rate numeric DEFAULT 0,
  weight numeric DEFAULT 1,
  pnl_total numeric DEFAULT 0,
  drawdown numeric DEFAULT 0,
  n_votes integer DEFAULT 0
);
GRANT SELECT, INSERT ON public.reputation_history TO authenticated;
GRANT ALL ON public.reputation_history TO service_role;
ALTER TABLE public.reputation_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_rep_hist" ON public.reputation_history FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX IF NOT EXISTS idx_rep_hist_agent ON public.reputation_history(agent_id, snapshot_at DESC);

-- 5. risk_events
CREATE TABLE IF NOT EXISTS public.risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trading_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.risk_events TO authenticated;
GRANT ALL ON public.risk_events TO service_role;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_risk_events" ON public.risk_events FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- 6. circuit_breaker_events
CREATE TABLE IF NOT EXISTS public.circuit_breaker_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trading_sessions(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  message text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.circuit_breaker_events TO authenticated;
GRANT ALL ON public.circuit_breaker_events TO service_role;
ALTER TABLE public.circuit_breaker_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_cb" ON public.circuit_breaker_events FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- 7. live_trade_metrics (daily aggregates)
CREATE TABLE IF NOT EXISTS public.live_trade_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.trading_sessions(id) ON DELETE CASCADE,
  day date NOT NULL,
  n_trades integer DEFAULT 0,
  n_wins integer DEFAULT 0,
  pnl numeric DEFAULT 0,
  drawdown numeric DEFAULT 0,
  win_rate numeric DEFAULT 0,
  profit_factor numeric DEFAULT 0,
  sharpe numeric DEFAULT 0,
  return_pct numeric DEFAULT 0,
  UNIQUE(session_id, day)
);
GRANT SELECT, INSERT, UPDATE ON public.live_trade_metrics TO authenticated;
GRANT ALL ON public.live_trade_metrics TO service_role;
ALTER TABLE public.live_trade_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_live_metrics" ON public.live_trade_metrics FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
