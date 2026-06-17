
-- ROLES
CREATE TYPE public.app_role AS ENUM ('owner');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_owner() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'owner'::public.app_role)
$$;

-- updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ROBOT SETTINGS (singleton id=1)
CREATE TABLE public.robot_settings (
  id INT PRIMARY KEY DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused','error')),
  mode TEXT NOT NULL DEFAULT 'read' CHECK (mode IN ('read','simulation','testnet','real')),
  collect_frequency_seconds INT NOT NULL DEFAULT 60,
  active_timeframes TEXT[] NOT NULL DEFAULT ARRAY['15m','1h','4h','1d'],
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  binance_mock_mode BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.robot_settings TO authenticated;
GRANT ALL ON public.robot_settings TO service_role;
ALTER TABLE public.robot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages robot_settings" ON public.robot_settings FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_robot_settings_touch BEFORE UPDATE ON public.robot_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.robot_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- BINANCE CONNECTION STATUS (singleton)
CREATE TABLE public.binance_connection_status (
  id INT PRIMARY KEY DEFAULT 1,
  connected BOOLEAN NOT NULL DEFAULT false,
  last_check TIMESTAMPTZ,
  last_error TEXT,
  account_type TEXT,
  permissions TEXT[],
  CONSTRAINT singleton_binance CHECK (id = 1)
);
GRANT SELECT ON public.binance_connection_status TO authenticated;
GRANT ALL ON public.binance_connection_status TO service_role;
ALTER TABLE public.binance_connection_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads binance status" ON public.binance_connection_status FOR SELECT TO authenticated USING (public.is_owner());
INSERT INTO public.binance_connection_status (id, connected) VALUES (1, false) ON CONFLICT DO NOTHING;

-- MONITORED ASSETS
CREATE TABLE public.monitored_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  pair TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  timeframes TEXT[] NOT NULL DEFAULT ARRAY['15m','1h','4h','1d'],
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitored_assets TO authenticated;
GRANT ALL ON public.monitored_assets TO service_role;
ALTER TABLE public.monitored_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages assets" ON public.monitored_assets FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_assets_touch BEFORE UPDATE ON public.monitored_assets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- MARKET SNAPSHOTS
CREATE TABLE public.market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair TEXT NOT NULL,
  price NUMERIC NOT NULL,
  change_percent_24h NUMERIC,
  volume_24h NUMERIC,
  high_24h NUMERIC,
  low_24h NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.market_snapshots (pair, captured_at DESC);
GRANT SELECT, INSERT ON public.market_snapshots TO authenticated;
GRANT ALL ON public.market_snapshots TO service_role;
ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads snapshots" ON public.market_snapshots FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner inserts snapshots" ON public.market_snapshots FOR INSERT TO authenticated WITH CHECK (public.is_owner());

-- CANDLES
CREATE TABLE public.candles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  open_time TIMESTAMPTZ NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume NUMERIC NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pair, timeframe, open_time)
);
CREATE INDEX ON public.candles (pair, timeframe, open_time DESC);
GRANT SELECT, INSERT ON public.candles TO authenticated;
GRANT ALL ON public.candles TO service_role;
ALTER TABLE public.candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads candles" ON public.candles FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner inserts candles" ON public.candles FOR INSERT TO authenticated WITH CHECK (public.is_owner());

-- INDICATORS
CREATE TABLE public.indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ma_short NUMERIC,
  ma_long NUMERIC,
  rsi NUMERIC,
  macd NUMERIC,
  macd_signal NUMERIC,
  volume_avg NUMERIC,
  change_24h NUMERIC,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.indicators (pair, timeframe, computed_at DESC);
GRANT SELECT, INSERT ON public.indicators TO authenticated;
GRANT ALL ON public.indicators TO service_role;
ALTER TABLE public.indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads indicators" ON public.indicators FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner inserts indicators" ON public.indicators FOR INSERT TO authenticated WITH CHECK (public.is_owner());

-- AGENTS
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  profile TEXT NOT NULL,
  weight NUMERIC NOT NULL DEFAULT 1.0,
  active BOOLEAN NOT NULL DEFAULT true,
  rules TEXT,
  veto_power BOOLEAN NOT NULL DEFAULT false,
  strategy_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages agents" ON public.agents FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_agents_touch BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- AGENT VOTES
CREATE TABLE public.agent_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  pair TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('buy','sell','hold','veto')),
  confidence NUMERIC NOT NULL DEFAULT 0,
  justification TEXT,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.agent_votes (agent_id, voted_at DESC);
GRANT SELECT, INSERT ON public.agent_votes TO authenticated;
GRANT ALL ON public.agent_votes TO service_role;
ALTER TABLE public.agent_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads votes" ON public.agent_votes FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner inserts votes" ON public.agent_votes FOR INSERT TO authenticated WITH CHECK (public.is_owner());

-- ALERTS
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  pair TEXT,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.alerts (created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages alerts" ON public.alerts FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- SYSTEM LOGS
CREATE TABLE public.system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('debug','info','warning','error','critical')),
  technical_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.system_logs (created_at DESC);
CREATE INDEX ON public.system_logs (event_type, created_at DESC);
GRANT SELECT, INSERT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads logs" ON public.system_logs FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner inserts logs" ON public.system_logs FOR INSERT TO authenticated WITH CHECK (public.is_owner());

-- Trigger: first registered user becomes the owner
CREATE OR REPLACE FUNCTION public.bootstrap_owner() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_bootstrap_owner
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_owner();
