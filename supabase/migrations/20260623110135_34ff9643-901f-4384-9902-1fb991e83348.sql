
-- Binance fee/profit guard: per-order fee accounting + gating thresholds.
ALTER TABLE public.simulated_orders
  ADD COLUMN IF NOT EXISTS buy_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fees numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_pnl numeric,
  ADD COLUMN IF NOT EXISTS net_pnl numeric,
  ADD COLUMN IF NOT EXISTS gross_roi_pct numeric,
  ADD COLUMN IF NOT EXISTS net_roi_pct numeric,
  ADD COLUMN IF NOT EXISTS expected_net_profit numeric,
  ADD COLUMN IF NOT EXISTS expected_roi_pct numeric;

ALTER TABLE public.committee_settings
  ADD COLUMN IF NOT EXISTS taker_fee_pct numeric NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS min_expected_roi_pct numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS min_net_profit_usd numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS fee_coverage_multiplier numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS per_trade_capital_pct numeric NOT NULL DEFAULT 0.35;

CREATE TABLE IF NOT EXISTS public.binance_trade_block_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair text NOT NULL,
  decision_id uuid,
  reason text NOT NULL,
  expected_net_profit numeric,
  expected_roi_pct numeric,
  total_fees_estimated numeric,
  position_value numeric,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.binance_trade_block_log TO authenticated;
GRANT ALL ON public.binance_trade_block_log TO service_role;

ALTER TABLE public.binance_trade_block_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages binance_trade_block_log"
  ON public.binance_trade_block_log
  FOR ALL TO authenticated
  USING (is_owner()) WITH CHECK (is_owner());

CREATE INDEX IF NOT EXISTS binance_trade_block_log_created_idx
  ON public.binance_trade_block_log (created_at DESC);
