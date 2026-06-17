
-- Extend agent_votes for committee
ALTER TABLE public.agent_votes DROP CONSTRAINT IF EXISTS agent_votes_vote_check;
ALTER TABLE public.agent_votes
  ADD COLUMN IF NOT EXISTS decision_id uuid,
  ADD COLUMN IF NOT EXISTS data_used jsonb,
  ADD COLUMN IF NOT EXISTS perceived_risk numeric,
  ADD COLUMN IF NOT EXISTS has_veto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS veto_reason text;
ALTER TABLE public.agent_votes
  ADD CONSTRAINT agent_votes_vote_check CHECK (vote IN ('buy','sell','hold','wait'));

-- Committee decisions
CREATE TABLE public.committee_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES public.monitored_assets(id) ON DELETE CASCADE,
  pair text NOT NULL,
  timeframe text NOT NULL,
  final_decision text NOT NULL CHECK (final_decision IN ('buy_approved','sell_approved','hold','wait','blocked')),
  score numeric NOT NULL DEFAULT 0,
  classification text NOT NULL,
  avg_confidence numeric NOT NULL DEFAULT 0,
  votes_buy integer NOT NULL DEFAULT 0,
  votes_sell integer NOT NULL DEFAULT 0,
  votes_hold integer NOT NULL DEFAULT 0,
  votes_wait integer NOT NULL DEFAULT 0,
  risk_approved boolean NOT NULL DEFAULT true,
  euphoria_vetoed boolean NOT NULL DEFAULT false,
  data_quality numeric NOT NULL DEFAULT 100,
  consolidated_justification text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.committee_decisions TO authenticated;
GRANT ALL ON public.committee_decisions TO service_role;
ALTER TABLE public.committee_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages committee_decisions" ON public.committee_decisions
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX committee_decisions_pair_created_idx ON public.committee_decisions (pair, created_at DESC);

-- Simulated wallet (singleton)
CREATE TABLE public.simulated_wallet (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  initial_balance numeric NOT NULL DEFAULT 10000,
  current_balance numeric NOT NULL DEFAULT 10000,
  equity numeric NOT NULL DEFAULT 10000,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.simulated_wallet TO authenticated;
GRANT ALL ON public.simulated_wallet TO service_role;
ALTER TABLE public.simulated_wallet ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages simulated_wallet" ON public.simulated_wallet
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
INSERT INTO public.simulated_wallet (id) VALUES (1);

-- Simulated positions
CREATE TABLE public.simulated_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair text UNIQUE NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  avg_price numeric NOT NULL DEFAULT 0,
  unrealized_pnl numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.simulated_positions TO authenticated;
GRANT ALL ON public.simulated_positions TO service_role;
ALTER TABLE public.simulated_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages simulated_positions" ON public.simulated_positions
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Simulated orders
CREATE TABLE public.simulated_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES public.committee_decisions(id) ON DELETE SET NULL,
  pair text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  quantity numeric NOT NULL,
  entry_price numeric NOT NULL,
  stop_price numeric,
  target_price numeric,
  score numeric NOT NULL DEFAULT 0,
  agents_favor integer NOT NULL DEFAULT 0,
  agents_against integer NOT NULL DEFAULT 0,
  justification text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  closed_price numeric,
  realized_pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.simulated_orders TO authenticated;
GRANT ALL ON public.simulated_orders TO service_role;
ALTER TABLE public.simulated_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages simulated_orders" ON public.simulated_orders
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX simulated_orders_pair_created_idx ON public.simulated_orders (pair, created_at DESC);

-- Committee settings (singleton)
CREATE TABLE public.committee_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_favor_votes integer NOT NULL DEFAULT 6,
  min_confidence numeric NOT NULL DEFAULT 70,
  min_score numeric NOT NULL DEFAULT 61,
  max_position_value numeric NOT NULL DEFAULT 1000,
  default_stop_pct numeric NOT NULL DEFAULT 3,
  default_target_pct numeric NOT NULL DEFAULT 6,
  timeframes text[] NOT NULL DEFAULT ARRAY['15m','1h','4h','1d'],
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.committee_settings TO authenticated;
GRANT ALL ON public.committee_settings TO service_role;
ALTER TABLE public.committee_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages committee_settings" ON public.committee_settings
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
INSERT INTO public.committee_settings (id) VALUES (1);

CREATE TRIGGER trg_committee_settings_touch BEFORE UPDATE ON public.committee_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_simulated_wallet_touch BEFORE UPDATE ON public.simulated_wallet
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_simulated_positions_touch BEFORE UPDATE ON public.simulated_positions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
