
-- Binance-only audit tables. Isolated from B3.

CREATE TABLE public.binance_position_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  decision_type text NOT NULL,
  requested_capital numeric,
  approved_capital numeric,
  committee_score numeric,
  council_score numeric,
  risk_score numeric,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.binance_position_decision_audit TO authenticated;
GRANT ALL ON public.binance_position_decision_audit TO service_role;
ALTER TABLE public.binance_position_decision_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner full access" ON public.binance_position_decision_audit
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX binance_pda_created_idx ON public.binance_position_decision_audit (created_at DESC);

CREATE TABLE public.binance_wallet_reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  divergence_type text NOT NULL,
  affected_symbol text,
  amount numeric,
  root_cause text,
  details jsonb,
  detected_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.binance_wallet_reconciliation_audit TO authenticated;
GRANT ALL ON public.binance_wallet_reconciliation_audit TO service_role;
ALTER TABLE public.binance_wallet_reconciliation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner full access" ON public.binance_wallet_reconciliation_audit
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX binance_wra_detected_idx ON public.binance_wallet_reconciliation_audit (detected_at DESC);
