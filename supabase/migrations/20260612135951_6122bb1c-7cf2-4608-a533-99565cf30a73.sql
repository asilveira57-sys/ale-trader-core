
CREATE TABLE public.historical_candles (
  asset_id uuid NOT NULL REFERENCES public.monitored_assets(id) ON DELETE CASCADE,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'binance',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, timeframe, open_time)
);
CREATE INDEX historical_candles_asset_tf_idx ON public.historical_candles (asset_id, timeframe, open_time DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_candles TO authenticated;
GRANT ALL ON public.historical_candles TO service_role;
ALTER TABLE public.historical_candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_historical_candles" ON public.historical_candles FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  mode text NOT NULL DEFAULT 'committee',
  started_at timestamptz,
  finished_at timestamptz,
  error_msg text,
  total_candles integer NOT NULL DEFAULT 0,
  processed_candles integer NOT NULL DEFAULT 0,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_runs TO authenticated;
GRANT ALL ON public.backtest_runs TO service_role;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_backtest_runs" ON public.backtest_runs FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.backtest_settings (
  run_id uuid PRIMARY KEY REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  assets jsonb NOT NULL,
  timeframes jsonb NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  initial_balance numeric NOT NULL DEFAULT 10000,
  max_trade_value numeric NOT NULL DEFAULT 1000,
  stop_loss_pct numeric NOT NULL DEFAULT 3,
  take_profit_pct numeric NOT NULL DEFAULT 6,
  fee_pct numeric NOT NULL DEFAULT 0.1,
  slippage_pct numeric NOT NULL DEFAULT 0.05,
  agent_ids jsonb,
  consensus_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  reinvest boolean NOT NULL DEFAULT true,
  drawdown_limit_pct numeric NOT NULL DEFAULT 20,
  loss_streak_limit integer NOT NULL DEFAULT 6,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_settings TO authenticated;
GRANT ALL ON public.backtest_settings TO service_role;
ALTER TABLE public.backtest_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_backtest_settings" ON public.backtest_settings FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.backtest_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.monitored_assets(id) ON DELETE SET NULL,
  pair text NOT NULL,
  timeframe text NOT NULL,
  side text NOT NULL,
  entry_time timestamptz NOT NULL,
  exit_time timestamptz,
  entry_price numeric NOT NULL,
  exit_price numeric,
  quantity numeric NOT NULL,
  fee_paid numeric NOT NULL DEFAULT 0,
  slippage_applied numeric NOT NULL DEFAULT 0,
  exit_reason text,
  pnl numeric,
  pnl_pct numeric,
  hold_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backtest_trades_run_idx ON public.backtest_trades (run_id, entry_time);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_trades TO authenticated;
GRANT ALL ON public.backtest_trades TO service_role;
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_backtest_trades" ON public.backtest_trades FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.backtest_agent_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  agent_name text NOT NULL,
  pair text NOT NULL,
  timeframe text NOT NULL,
  candle_time timestamptz NOT NULL,
  vote text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  perceived_risk numeric NOT NULL DEFAULT 50,
  has_veto boolean NOT NULL DEFAULT false,
  weight_used numeric NOT NULL DEFAULT 1,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backtest_agent_votes_run_agent_idx ON public.backtest_agent_votes (run_id, agent_name);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_agent_votes TO authenticated;
GRANT ALL ON public.backtest_agent_votes TO service_role;
ALTER TABLE public.backtest_agent_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_backtest_agent_votes" ON public.backtest_agent_votes FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.backtest_metrics (
  run_id uuid PRIMARY KEY REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  total_pnl numeric NOT NULL DEFAULT 0,
  return_pct numeric NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  n_trades integer NOT NULL DEFAULT 0,
  n_wins integer NOT NULL DEFAULT 0,
  n_losses integer NOT NULL DEFAULT 0,
  biggest_win numeric NOT NULL DEFAULT 0,
  biggest_loss numeric NOT NULL DEFAULT 0,
  max_drawdown numeric NOT NULL DEFAULT 0,
  max_drawdown_pct numeric NOT NULL DEFAULT 0,
  max_loss_streak integer NOT NULL DEFAULT 0,
  max_win_streak integer NOT NULL DEFAULT 0,
  profit_factor numeric NOT NULL DEFAULT 0,
  avg_rr numeric NOT NULL DEFAULT 0,
  avg_hold_minutes numeric NOT NULL DEFAULT 0,
  breakdown_by_asset jsonb,
  breakdown_by_timeframe jsonb,
  breakdown_by_agent jsonb,
  breakdown_by_decision jsonb,
  equity_curve jsonb,
  drawdown_curve jsonb,
  final_balance numeric NOT NULL DEFAULT 0,
  initial_balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_metrics TO authenticated;
GRANT ALL ON public.backtest_metrics TO service_role;
ALTER TABLE public.backtest_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_backtest_metrics" ON public.backtest_metrics FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.backtest_reports (
  run_id uuid PRIMARY KEY REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  summary text,
  highlights jsonb,
  warnings jsonb,
  recommendation text,
  best_trades jsonb,
  worst_trades jsonb,
  pdf_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_reports TO authenticated;
GRANT ALL ON public.backtest_reports TO service_role;
ALTER TABLE public.backtest_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_backtest_reports" ON public.backtest_reports FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.agent_performance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  run_id uuid NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  hit_rate numeric NOT NULL DEFAULT 0,
  profit_simulated numeric NOT NULL DEFAULT 0,
  drawdown_caused numeric NOT NULL DEFAULT 0,
  good_votes integer NOT NULL DEFAULT 0,
  bad_votes integer NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_performance_history_agent_idx ON public.agent_performance_history (agent_name);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_performance_history TO authenticated;
GRANT ALL ON public.agent_performance_history TO service_role;
ALTER TABLE public.agent_performance_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_agent_performance_history" ON public.agent_performance_history FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.strategy_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  run_ids jsonb NOT NULL,
  baseline_run_id uuid REFERENCES public.backtest_runs(id) ON DELETE SET NULL,
  deltas jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_comparisons TO authenticated;
GRANT ALL ON public.strategy_comparisons TO service_role;
ALTER TABLE public.strategy_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_strategy_comparisons" ON public.strategy_comparisons FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
