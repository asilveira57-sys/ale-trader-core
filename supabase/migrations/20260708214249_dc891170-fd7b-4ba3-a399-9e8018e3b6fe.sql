
-- ============ B3 MT5 Simulação Local (WINQ26) ============

-- 1) Settings (1 linha por user)
CREATE TABLE public.b3_mt5sim_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  market text NOT NULL DEFAULT 'WIN',
  mt5_symbol text NOT NULL DEFAULT 'WINQ26',
  server text NOT NULL DEFAULT 'XPMT5-PRD',
  account_masked text,
  tick_size numeric NOT NULL DEFAULT 5,
  tick_value_brl numeric NOT NULL DEFAULT 1.00,
  point_value_brl numeric NOT NULL DEFAULT 0.20,
  default_volume int NOT NULL DEFAULT 1,
  price_source text NOT NULL DEFAULT 'bid_ask' CHECK (price_source IN ('last','bid_ask','bid_ask_slip')),
  slippage_ticks numeric NOT NULL DEFAULT 1,
  fee_per_contract_brl numeric NOT NULL DEFAULT 0.50,
  use_spread boolean NOT NULL DEFAULT true,
  poll_interval_ms int NOT NULL DEFAULT 1000,
  quote_ttl_seconds int NOT NULL DEFAULT 15,
  session_start time NOT NULL DEFAULT '09:00',
  session_end time NOT NULL DEFAULT '17:55',
  kill_switch_real boolean NOT NULL DEFAULT true,
  allow_long boolean NOT NULL DEFAULT true,
  allow_short boolean NOT NULL DEFAULT true,
  allow_reverse boolean NOT NULL DEFAULT true,
  min_trades_per_robot int NOT NULL DEFAULT 40,
  min_days int NOT NULL DEFAULT 5,
  max_price_divergence_pts numeric NOT NULL DEFAULT 15,
  max_drawdown_brl numeric NOT NULL DEFAULT 300,
  min_hit_rate numeric NOT NULL DEFAULT 0.50,
  min_net_pnl_brl numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_settings TO authenticated;
GRANT ALL ON public.b3_mt5sim_settings TO service_role;
ALTER TABLE public.b3_mt5sim_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.b3_mt5sim_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_mt5sim_settings_updated BEFORE UPDATE ON public.b3_mt5sim_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Robôs participantes
CREATE TABLE public.b3_mt5sim_robots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile text NOT NULL CHECK (profile IN ('conservador','moderado','equilibrado','semi_agressivo','agressivo')),
  enabled boolean NOT NULL DEFAULT true,
  volume int NOT NULL DEFAULT 1,
  initial_balance_brl numeric NOT NULL DEFAULT 1000,
  daily_loss_limit_brl numeric NOT NULL DEFAULT 100,
  daily_gain_limit_brl numeric NOT NULL DEFAULT 300,
  max_trades_day int NOT NULL DEFAULT 20,
  max_drawdown_brl numeric NOT NULL DEFAULT 150,
  max_consec_losses int NOT NULL DEFAULT 4,
  min_score numeric NOT NULL DEFAULT 55,
  signal_ttl_s int NOT NULL DEFAULT 30,
  max_spread_ticks numeric NOT NULL DEFAULT 3,
  strategy_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, profile)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_robots TO authenticated;
GRANT ALL ON public.b3_mt5sim_robots TO service_role;
ALTER TABLE public.b3_mt5sim_robots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own robots" ON public.b3_mt5sim_robots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_mt5sim_robots_updated BEFORE UPDATE ON public.b3_mt5sim_robots FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Runs
CREATE TABLE public.b3_mt5sim_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','stopped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_runs TO authenticated;
GRANT ALL ON public.b3_mt5sim_runs TO service_role;
ALTER TABLE public.b3_mt5sim_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs" ON public.b3_mt5sim_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_mt5sim_runs_status ON public.b3_mt5sim_runs (status);

-- 4) Cotações
CREATE TABLE public.b3_mt5sim_quotes (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  bid numeric,
  ask numeric,
  last numeric,
  spread numeric,
  volume numeric,
  symbol_status text,
  mt5_connected boolean,
  server text,
  account_masked text,
  tick_ts timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_quotes TO authenticated;
GRANT ALL ON public.b3_mt5sim_quotes TO service_role;
ALTER TABLE public.b3_mt5sim_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own quotes" ON public.b3_mt5sim_quotes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_mt5sim_quotes_user_ts ON public.b3_mt5sim_quotes (user_id, symbol, received_at DESC);

-- 5) Wallet diária por robô
CREATE TABLE public.b3_mt5sim_wallet_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  robot_id uuid NOT NULL REFERENCES public.b3_mt5sim_robots(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  starting_balance_brl numeric NOT NULL DEFAULT 0,
  current_balance_brl numeric NOT NULL DEFAULT 0,
  pnl_gross_brl numeric NOT NULL DEFAULT 0,
  pnl_net_brl numeric NOT NULL DEFAULT 0,
  fees_brl numeric NOT NULL DEFAULT 0,
  trades_count int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  hit_rate numeric NOT NULL DEFAULT 0,
  best_trade_brl numeric NOT NULL DEFAULT 0,
  worst_trade_brl numeric NOT NULL DEFAULT 0,
  drawdown_brl numeric NOT NULL DEFAULT 0,
  peak_balance_brl numeric NOT NULL DEFAULT 0,
  points_net numeric NOT NULL DEFAULT 0,
  consec_losses int NOT NULL DEFAULT 0,
  blocks_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  position_side text,
  position_qty numeric,
  position_avg_price numeric,
  last_signal_at timestamptz,
  last_block_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, robot_id, session_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_wallet_daily TO authenticated;
GRANT ALL ON public.b3_mt5sim_wallet_daily TO service_role;
ALTER TABLE public.b3_mt5sim_wallet_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wallet" ON public.b3_mt5sim_wallet_daily FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_b3_mt5sim_wallet_updated BEFORE UPDATE ON public.b3_mt5sim_wallet_daily FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6) Sinais
CREATE TABLE public.b3_mt5sim_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  robot_id uuid NOT NULL REFERENCES public.b3_mt5sim_robots(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  price_signal numeric NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  reason text,
  ts timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','used','expired','blocked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_signals TO authenticated;
GRANT ALL ON public.b3_mt5sim_signals TO service_role;
ALTER TABLE public.b3_mt5sim_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own signals" ON public.b3_mt5sim_signals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_mt5sim_signals_user_ts ON public.b3_mt5sim_signals (user_id, ts DESC);

-- 7) Trades simuladas
CREATE TABLE public.b3_mt5sim_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  robot_id uuid NOT NULL REFERENCES public.b3_mt5sim_robots(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.b3_mt5sim_signals(id) ON DELETE SET NULL,
  market text NOT NULL DEFAULT 'WIN',
  logical_symbol text NOT NULL DEFAULT 'WIN',
  mt5_symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  volume int NOT NULL DEFAULT 1,
  price_signal numeric,
  price_entry_sim numeric NOT NULL,
  price_exit_sim numeric,
  ts_signal timestamptz,
  ts_entry timestamptz NOT NULL DEFAULT now(),
  ts_exit timestamptz,
  spread numeric,
  slippage_ticks numeric,
  fee_brl numeric NOT NULL DEFAULT 0,
  points_result numeric,
  gross_brl numeric,
  net_brl numeric,
  entry_reason text,
  exit_reason text,
  locks_triggered jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  observations text,
  session_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_trades TO authenticated;
GRANT ALL ON public.b3_mt5sim_trades TO service_role;
ALTER TABLE public.b3_mt5sim_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trades" ON public.b3_mt5sim_trades FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_mt5sim_trades_user_ts ON public.b3_mt5sim_trades (user_id, ts_entry DESC);
CREATE INDEX idx_b3_mt5sim_trades_robot_open ON public.b3_mt5sim_trades (user_id, robot_id, status);
CREATE TRIGGER trg_b3_mt5sim_trades_updated BEFORE UPDATE ON public.b3_mt5sim_trades FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 8) Bloqueios
CREATE TABLE public.b3_mt5sim_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  robot_id uuid REFERENCES public.b3_mt5sim_robots(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.b3_mt5sim_signals(id) ON DELETE SET NULL,
  lock_kind text NOT NULL,
  observed numeric,
  limit_value numeric,
  reason text,
  ts timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_blocks TO authenticated;
GRANT ALL ON public.b3_mt5sim_blocks TO service_role;
ALTER TABLE public.b3_mt5sim_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks" ON public.b3_mt5sim_blocks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_mt5sim_blocks_user_ts ON public.b3_mt5sim_blocks (user_id, ts DESC);

-- 9) Conflitos
CREATE TABLE public.b3_mt5sim_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  robots jsonb NOT NULL,
  sides jsonb NOT NULL,
  prices jsonb NOT NULL,
  outcome jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_conflicts TO authenticated;
GRANT ALL ON public.b3_mt5sim_conflicts TO service_role;
ALTER TABLE public.b3_mt5sim_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conflicts" ON public.b3_mt5sim_conflicts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_b3_mt5sim_conflicts_user_ts ON public.b3_mt5sim_conflicts (user_id, ts DESC);

-- 10) Tentativas de ordem real (auditoria crítica)
CREATE TABLE public.b3_mt5sim_order_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  action text NOT NULL,
  payload jsonb,
  blocked boolean NOT NULL DEFAULT true,
  message text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_order_attempts TO authenticated;
GRANT ALL ON public.b3_mt5sim_order_attempts TO service_role;
ALTER TABLE public.b3_mt5sim_order_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own attempts" ON public.b3_mt5sim_order_attempts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
