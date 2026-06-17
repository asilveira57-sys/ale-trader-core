
-- Estende robot_settings
ALTER TABLE public.robot_settings
  ADD COLUMN IF NOT EXISTS production_assisted_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_auto_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_score_for_real numeric NOT NULL DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS require_manual_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS real_robot_paused boolean NOT NULL DEFAULT false;

-- real_trade_requests
CREATE TABLE public.real_trade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  decision_id uuid,
  asset_id uuid,
  pair text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  suggested_qty numeric NOT NULL,
  suggested_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  risk_amount numeric NOT NULL,
  score numeric NOT NULL,
  votes_for integer NOT NULL DEFAULT 0,
  votes_against integer NOT NULL DEFAULT 0,
  vetoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  justification text,
  worst_case numeric,
  expected_result numeric,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','executed','failed')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.real_trade_requests TO authenticated;
GRANT ALL ON public.real_trade_requests TO service_role;
ALTER TABLE public.real_trade_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all real_trade_requests" ON public.real_trade_requests FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_real_trade_requests_touch BEFORE UPDATE ON public.real_trade_requests FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- real_trade_approvals
CREATE TABLE public.real_trade_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.real_trade_requests(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve','reject','pause')),
  ip text,
  user_agent text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.real_trade_approvals TO authenticated;
GRANT ALL ON public.real_trade_approvals TO service_role;
ALTER TABLE public.real_trade_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all real_trade_approvals" ON public.real_trade_approvals FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- real_orders
CREATE TABLE public.real_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.real_trade_requests(id) ON DELETE SET NULL,
  session_id uuid,
  asset_id uuid,
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
  submitted_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz,
  pnl numeric,
  pnl_pct numeric
);
GRANT SELECT, INSERT, UPDATE ON public.real_orders TO authenticated;
GRANT ALL ON public.real_orders TO service_role;
ALTER TABLE public.real_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all real_orders" ON public.real_orders FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- real_positions
CREATE TABLE public.real_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.real_orders(id) ON DELETE SET NULL,
  request_id uuid REFERENCES public.real_trade_requests(id) ON DELETE SET NULL,
  asset_id uuid,
  pair text NOT NULL,
  side text NOT NULL,
  entry_price numeric NOT NULL,
  qty numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  exit_price numeric,
  exit_reason text,
  pnl numeric,
  pnl_pct numeric,
  last_price numeric,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.real_positions TO authenticated;
GRANT ALL ON public.real_positions TO service_role;
ALTER TABLE public.real_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all real_positions" ON public.real_positions FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- real_risk_limits (singleton)
CREATE TABLE public.real_risk_limits (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_per_trade numeric NOT NULL DEFAULT 50,
  max_pct_portfolio numeric NOT NULL DEFAULT 5,
  daily_loss_limit numeric NOT NULL DEFAULT 100,
  weekly_loss_limit numeric NOT NULL DEFAULT 300,
  monthly_loss_limit numeric NOT NULL DEFAULT 800,
  max_trades_per_day integer NOT NULL DEFAULT 5,
  max_open_positions integer NOT NULL DEFAULT 3,
  loss_streak_limit integer NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.real_risk_limits TO authenticated;
GRANT ALL ON public.real_risk_limits TO service_role;
ALTER TABLE public.real_risk_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all real_risk_limits" ON public.real_risk_limits FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
INSERT INTO public.real_risk_limits (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TRIGGER trg_real_risk_limits_touch BEFORE UPDATE ON public.real_risk_limits FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- real_circuit_breaker_events
CREATE TABLE public.real_circuit_breaker_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  severity text NOT NULL DEFAULT 'critical',
  message text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.real_circuit_breaker_events TO authenticated;
GRANT ALL ON public.real_circuit_breaker_events TO service_role;
ALTER TABLE public.real_circuit_breaker_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all real_cb" ON public.real_circuit_breaker_events FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- audit_reports
CREATE TABLE public.audit_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.real_trade_requests(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.real_positions(id) ON DELETE SET NULL,
  phase text NOT NULL CHECK (phase IN ('pre','during','post')),
  summary text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  classification text CHECK (classification IN ('excellent','good','neutral','bad','critical')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.audit_reports TO authenticated;
GRANT ALL ON public.audit_reports TO service_role;
ALTER TABLE public.audit_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all audit_reports" ON public.audit_reports FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- audit_events
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  position_id uuid,
  kind text NOT NULL,
  message text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all audit_events" ON public.audit_events FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- trade_explanations
CREATE TABLE public.trade_explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  position_id uuid,
  generated_by text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trade_explanations TO authenticated;
GRANT ALL ON public.trade_explanations TO service_role;
ALTER TABLE public.trade_explanations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all trade_explanations" ON public.trade_explanations FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

-- approval_logs (imutável, sem update/delete)
CREATE TABLE public.approval_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  user_id uuid,
  action text NOT NULL,
  ip text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.approval_logs TO authenticated;
GRANT ALL ON public.approval_logs TO service_role;
ALTER TABLE public.approval_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read approval_logs" ON public.approval_logs FOR SELECT USING (public.is_owner());
CREATE POLICY "owner insert approval_logs" ON public.approval_logs FOR INSERT WITH CHECK (public.is_owner());
