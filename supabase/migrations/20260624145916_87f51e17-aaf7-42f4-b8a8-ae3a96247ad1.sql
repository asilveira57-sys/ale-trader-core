-- Fase: criar 5º robô B3 "equilibrado" (entre moderado e semi_agressivo)

ALTER TABLE public.b3_simulation_modes DROP CONSTRAINT IF EXISTS b3_simulation_modes_mode_check;
ALTER TABLE public.b3_simulation_modes
  ADD CONSTRAINT b3_simulation_modes_mode_check
  CHECK (mode IN ('conservador','moderado','equilibrado','semi_agressivo','agressivo'));

ALTER TABLE public.b3_simulation_mode_settings DROP CONSTRAINT IF EXISTS b3_simulation_mode_settings_mode_check;
ALTER TABLE public.b3_simulation_mode_settings
  ADD CONSTRAINT b3_simulation_mode_settings_mode_check
  CHECK (mode IN ('conservador','moderado','equilibrado','semi_agressivo','agressivo'));

-- Backfill: cria linha equilibrado para toda simulação existente
INSERT INTO public.b3_simulation_modes (simulation_run_id, user_id, mode, initial_balance, current_balance)
SELECT r.id, r.user_id, 'equilibrado', r.initial_balance, r.initial_balance
FROM public.b3_simulation_runs r
ON CONFLICT (simulation_run_id, mode) DO NOTHING;

INSERT INTO public.b3_simulation_mode_settings (
  simulation_run_id, user_id, mode,
  min_approve_votes, min_confidence, min_score, max_contracts,
  stop_pts, gain_pts, max_volatility_pct,
  daily_loss_limit_brl, daily_gain_target_brl,
  trading_start_time, entry_cutoff_time, force_close_time
)
SELECT r.id, r.user_id, 'equilibrado',
  5, 70, 62, 3,
  220, 440, 3.8,
  500, 700,
  COALESCE(r.trading_start_time,'09:15'),
  COALESCE(r.entry_cutoff_time,'16:30'),
  COALESCE(r.force_close_time,'16:55')
FROM public.b3_simulation_runs r
ON CONFLICT (simulation_run_id, mode) DO NOTHING;