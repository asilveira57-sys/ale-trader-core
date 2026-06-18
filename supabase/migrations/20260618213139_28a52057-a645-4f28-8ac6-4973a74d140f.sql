
-- ============================================================
-- B3 Day Trade module — fully separated from Binance module
-- ============================================================

-- b3_trading_settings
CREATE TABLE public.b3_trading_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_name TEXT NOT NULL DEFAULT 'simulado',
  api_status TEXT NOT NULL DEFAULT 'disconnected',
  environment TEXT NOT NULL DEFAULT 'simulation' CHECK (environment IN ('simulation','real')),
  capital_allocated NUMERIC(14,2) NOT NULL DEFAULT 10000,
  max_contracts INTEGER NOT NULL DEFAULT 1,
  daily_loss_limit NUMERIC(14,2) NOT NULL DEFAULT 300,
  daily_gain_target NUMERIC(14,2) NOT NULL DEFAULT 500,
  stop_points INTEGER NOT NULL DEFAULT 150,
  gain_points INTEGER NOT NULL DEFAULT 300,
  start_time TIME NOT NULL DEFAULT '09:05',
  end_time TIME NOT NULL DEFAULT '17:30',
  force_close_time TIME NOT NULL DEFAULT '17:45',
  strategy_mode TEXT NOT NULL DEFAULT 'moderado' CHECK (strategy_mode IN ('conservador','moderado','agressivo')),
  auto_trade_enabled BOOLEAN NOT NULL DEFAULT false,
  alert_only_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_trading_settings TO authenticated;
GRANT ALL ON public.b3_trading_settings TO service_role;
ALTER TABLE public.b3_trading_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b3_settings_owner_all" ON public.b3_trading_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- b3_orders
CREATE TABLE public.b3_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL DEFAULT 'WIN',
  contract_code TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  entry_price NUMERIC(14,2) NOT NULL,
  exit_price NUMERIC(14,2),
  quantity INTEGER NOT NULL DEFAULT 1,
  entry_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_time TIMESTAMPTZ,
  gross_result_points NUMERIC(14,2),
  gross_result_brl NUMERIC(14,2),
  fees NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_result_brl NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled','rejected')),
  close_reason TEXT,
  environment TEXT NOT NULL DEFAULT 'simulation' CHECK (environment IN ('simulation','real')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX b3_orders_user_idx ON public.b3_orders(user_id, created_at DESC);
CREATE INDEX b3_orders_status_idx ON public.b3_orders(user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_orders TO authenticated;
GRANT ALL ON public.b3_orders TO service_role;
ALTER TABLE public.b3_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b3_orders_owner_all" ON public.b3_orders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- b3_agent_votes
CREATE TABLE public.b3_agent_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.b3_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('approve','reject','neutral')),
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  reason TEXT,
  market_data_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX b3_agent_votes_order_idx ON public.b3_agent_votes(order_id);
CREATE INDEX b3_agent_votes_user_idx ON public.b3_agent_votes(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_agent_votes TO authenticated;
GRANT ALL ON public.b3_agent_votes TO service_role;
ALTER TABLE public.b3_agent_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b3_agent_votes_owner_all" ON public.b3_agent_votes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- b3_daily_report
CREATE TABLE public.b3_daily_report (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
  starting_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_bought NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_sold NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_result NUMERIC(14,2) NOT NULL DEFAULT 0,
  fees NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_result NUMERIC(14,2) NOT NULL DEFAULT 0,
  open_positions INTEGER NOT NULL DEFAULT 0,
  closed_positions INTEGER NOT NULL DEFAULT 0,
  daily_status TEXT NOT NULL DEFAULT 'active'
    CHECK (daily_status IN ('active','stopped_by_loss','stopped_by_gain','force_closed','manual_pause')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, trade_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_daily_report TO authenticated;
GRANT ALL ON public.b3_daily_report TO service_role;
ALTER TABLE public.b3_daily_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b3_daily_owner_all" ON public.b3_daily_report
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers (reuse touch_updated_at if present)
CREATE TRIGGER b3_settings_touch BEFORE UPDATE ON public.b3_trading_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER b3_orders_touch BEFORE UPDATE ON public.b3_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER b3_daily_touch BEFORE UPDATE ON public.b3_daily_report
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
