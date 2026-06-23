-- Phase 2.6: add semi_agressivo mode to B3 simulation tables

ALTER TABLE public.b3_simulation_modes DROP CONSTRAINT IF EXISTS b3_simulation_modes_mode_check;
ALTER TABLE public.b3_simulation_modes
  ADD CONSTRAINT b3_simulation_modes_mode_check
  CHECK (mode IN ('conservador','moderado','semi_agressivo','agressivo'));

ALTER TABLE public.b3_simulation_mode_settings DROP CONSTRAINT IF EXISTS b3_simulation_mode_settings_mode_check;
ALTER TABLE public.b3_simulation_mode_settings
  ADD CONSTRAINT b3_simulation_mode_settings_mode_check
  CHECK (mode IN ('conservador','moderado','semi_agressivo','agressivo'));

-- Backfill semi_agressivo row for every existing run
INSERT INTO public.b3_simulation_modes (simulation_run_id, user_id, mode, initial_balance, current_balance)
SELECT r.id, r.user_id, 'semi_agressivo', r.initial_balance, r.initial_balance
FROM public.b3_simulation_runs r
ON CONFLICT (simulation_run_id, mode) DO NOTHING;

INSERT INTO public.b3_simulation_mode_settings (
  simulation_run_id, user_id, mode,
  min_approve_votes, min_confidence, min_score, max_contracts,
  stop_pts, gain_pts, max_volatility_pct,
  daily_loss_limit_brl, daily_gain_target_brl,
  trading_start_time, entry_cutoff_time, force_close_time
)
SELECT r.id, r.user_id, 'semi_agressivo',
  5, 60, 60, 4,
  300, 600, 4.0,
  800, 1000,
  COALESCE(r.trading_start_time,'09:15'),
  COALESCE(r.entry_cutoff_time,'16:30'),
  COALESCE(r.force_close_time,'16:55')
FROM public.b3_simulation_runs r
ON CONFLICT (simulation_run_id, mode) DO NOTHING;