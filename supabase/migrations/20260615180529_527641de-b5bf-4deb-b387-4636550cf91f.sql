
-- Phase 7: Controlled Automatic Production

-- automated_trades
CREATE TABLE public.automated_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES public.real_trade_requests(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.trading_sessions(id) ON DELETE SET NULL,
  asset_id UUID REFERENCES public.monitored_assets(id) ON DELETE SET NULL,
  side TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  risk_amount NUMERIC,
  automation_level INT NOT NULL DEFAULT 1,
  score NUMERIC,
  consensus NUMERIC,
  supervisor_decision TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  exit_price NUMERIC,
  exit_reason TEXT,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automated_trades TO authenticated;
GRANT ALL ON public.automated_trades TO service_role;
ALTER TABLE public.automated_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_automated_trades" ON public.automated_trades FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_touch_automated_trades BEFORE UPDATE ON public.automated_trades FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- automated_trade_audits
CREATE TABLE public.automated_trade_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automated_trade_id UUID REFERENCES public.automated_trades(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  decision_chain JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automated_trade_audits TO authenticated;
GRANT ALL ON public.automated_trade_audits TO service_role;
ALTER TABLE public.automated_trade_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_automated_trade_audits" ON public.automated_trade_audits FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- supervisor_reviews
CREATE TABLE public.supervisor_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES public.real_trade_requests(id) ON DELETE SET NULL,
  automated_trade_id UUID REFERENCES public.automated_trades(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL,
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_quality_score NUMERIC,
  justification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supervisor_reviews TO authenticated;
GRANT ALL ON public.supervisor_reviews TO service_role;
ALTER TABLE public.supervisor_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_supervisor_reviews" ON public.supervisor_reviews FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- robot_confidence
CREATE TABLE public.robot_confidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score NUMERIC NOT NULL,
  accuracy_component NUMERIC,
  performance_component NUMERIC,
  drawdown_component NUMERIC,
  agents_precision_component NUMERIC,
  data_quality_component NUMERIC,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.robot_confidence TO authenticated;
GRANT ALL ON public.robot_confidence TO service_role;
ALTER TABLE public.robot_confidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_robot_confidence" ON public.robot_confidence FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- capital_management_history
CREATE TABLE public.capital_management_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance NUMERIC,
  suggested_size NUMERIC,
  volatility NUMERIC,
  recent_performance NUMERIC,
  current_drawdown NUMERIC,
  confidence NUMERIC,
  final_size NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_management_history TO authenticated;
GRANT ALL ON public.capital_management_history TO service_role;
ALTER TABLE public.capital_management_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_capital_management_history" ON public.capital_management_history FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- dynamic_agent_weights
CREATE TABLE public.dynamic_agent_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  previous_weight NUMERIC,
  new_weight NUMERIC,
  reason TEXT,
  performance_window INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dynamic_agent_weights TO authenticated;
GRANT ALL ON public.dynamic_agent_weights TO service_role;
ALTER TABLE public.dynamic_agent_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_dynamic_agent_weights" ON public.dynamic_agent_weights FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- governance_settings (singleton)
CREATE TABLE public.governance_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_enabled BOOLEAN NOT NULL DEFAULT false,
  automation_level INT NOT NULL DEFAULT 1,
  min_confidence_score NUMERIC NOT NULL DEFAULT 70,
  min_score_for_auto NUMERIC NOT NULL DEFAULT 75,
  min_consensus_for_auto NUMERIC NOT NULL DEFAULT 0.7,
  min_risk_reward NUMERIC NOT NULL DEFAULT 1.5,
  max_consecutive_losses INT NOT NULL DEFAULT 3,
  max_daily_losses INT NOT NULL DEFAULT 5,
  max_weekly_losses INT NOT NULL DEFAULT 10,
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 15,
  supervisor_enabled BOOLEAN NOT NULL DEFAULT true,
  kill_switch_active BOOLEAN NOT NULL DEFAULT false,
  kill_switch_activated_at TIMESTAMPTZ,
  kill_switch_reason TEXT,
  eligibility_min_days INT NOT NULL DEFAULT 60,
  eligibility_min_trades INT NOT NULL DEFAULT 200,
  eligibility_min_profit_factor NUMERIC NOT NULL DEFAULT 1.3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.governance_settings TO authenticated;
GRANT ALL ON public.governance_settings TO service_role;
ALTER TABLE public.governance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_governance_settings" ON public.governance_settings FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_touch_governance_settings BEFORE UPDATE ON public.governance_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.governance_settings DEFAULT VALUES;

-- risk_incidents
CREATE TABLE public.risk_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  message TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_incidents TO authenticated;
GRANT ALL ON public.risk_incidents TO service_role;
ALTER TABLE public.risk_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_risk_incidents" ON public.risk_incidents FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- daily_reports
CREATE TABLE public.daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  total_trades INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  drawdown NUMERIC,
  net_pnl NUMERIC,
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations TEXT,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reports TO authenticated;
GRANT ALL ON public.daily_reports TO service_role;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_daily_reports" ON public.daily_reports FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- weekly_reports
CREATE TABLE public.weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  performance JSONB NOT NULL DEFAULT '{}'::jsonb,
  agent_ranking JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  problem_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_adjustments TEXT,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_reports TO authenticated;
GRANT ALL ON public.weekly_reports TO service_role;
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_weekly_reports" ON public.weekly_reports FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
