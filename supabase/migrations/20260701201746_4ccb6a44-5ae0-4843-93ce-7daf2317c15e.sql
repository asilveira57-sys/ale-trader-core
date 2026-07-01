
-- B3 Protection: parâmetros configuráveis por modo
ALTER TABLE public.b3_simulation_mode_settings
  ADD COLUMN IF NOT EXISTS minimum_trades_before_profit_lock int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS minimum_operating_minutes int NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS profit_multiplier_before_lock numeric NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS post_target_allowed_retracement numeric NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS consecutive_loss_after_target int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS post_target_size_reduction numeric NOT NULL DEFAULT 0.50;

-- B3 Protection: estado runtime por modo/run
ALTER TABLE public.b3_simulation_modes
  ADD COLUMN IF NOT EXISTS protection_state text NOT NULL DEFAULT 'operating_normal',
  ADD COLUMN IF NOT EXISTS target_reached_at timestamptz,
  ADD COLUMN IF NOT EXISTS profit_at_target_brl numeric,
  ADD COLUMN IF NOT EXISTS trades_at_target int,
  ADD COLUMN IF NOT EXISTS peak_profit_after_target_brl numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_after_target_brl numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trades_after_target int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_losses_after_target int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS protection_block_reason text,
  ADD COLUMN IF NOT EXISTS protection_day_key date;

-- Histórico diário de proteção B3
CREATE TABLE IF NOT EXISTS public.b3_daily_protection_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  simulation_run_id uuid,
  simulation_mode_id uuid,
  mode text NOT NULL,
  day_key date NOT NULL,
  target_reached_at timestamptz,
  block_at timestamptz,
  profit_at_target_brl numeric,
  peak_profit_after_target_brl numeric,
  profit_after_target_brl numeric,
  given_back_brl numeric,
  profit_at_close_brl numeric,
  trades_total int,
  trades_after_target int,
  drawdown_after_target_brl numeric,
  block_reason text,
  final_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, simulation_run_id, mode, day_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_daily_protection_history TO authenticated;
GRANT ALL ON public.b3_daily_protection_history TO service_role;

ALTER TABLE public.b3_daily_protection_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "b3_protection_history_owner_all"
  ON public.b3_daily_protection_history
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_b3_prot_hist_user_day
  ON public.b3_daily_protection_history (user_id, day_key DESC);

CREATE TRIGGER trg_b3_prot_hist_touch
  BEFORE UPDATE ON public.b3_daily_protection_history
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
