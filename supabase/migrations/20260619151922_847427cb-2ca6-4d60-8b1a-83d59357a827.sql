CREATE TABLE public.b3_simulation_mode_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid NOT NULL REFERENCES public.b3_simulation_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('conservador','moderado','agressivo')),
  enabled boolean NOT NULL DEFAULT true,
  min_approve_votes integer NOT NULL DEFAULT 5,
  min_confidence integer NOT NULL DEFAULT 62,
  min_score integer NOT NULL DEFAULT 65,
  max_contracts integer NOT NULL DEFAULT 2,
  stop_pts integer NOT NULL DEFAULT 150,
  gain_pts integer NOT NULL DEFAULT 300,
  max_volatility_pct numeric NOT NULL DEFAULT 3.5,
  daily_loss_limit_brl numeric NOT NULL DEFAULT 300,
  daily_gain_target_brl numeric NOT NULL DEFAULT 500,
  trading_start_time text NOT NULL DEFAULT '09:15',
  entry_cutoff_time text NOT NULL DEFAULT '16:30',
  force_close_time text NOT NULL DEFAULT '16:55',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (simulation_run_id, mode)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_simulation_mode_settings TO authenticated;
GRANT ALL ON public.b3_simulation_mode_settings TO service_role;

ALTER TABLE public.b3_simulation_mode_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own b3_simulation_mode_settings"
  ON public.b3_simulation_mode_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_b3_sim_mode_settings_upd
  BEFORE UPDATE ON public.b3_simulation_mode_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: 3 linhas por run existente, com defaults por modo (mesmos do código atual)
INSERT INTO public.b3_simulation_mode_settings (
  simulation_run_id, user_id, mode,
  min_approve_votes, min_confidence, min_score,
  max_contracts, stop_pts, gain_pts, max_volatility_pct,
  daily_loss_limit_brl, daily_gain_target_brl,
  trading_start_time, entry_cutoff_time, force_close_time
)
SELECT r.id, r.user_id, m.mode,
  CASE m.mode WHEN 'conservador' THEN 6 WHEN 'agressivo' THEN 4 ELSE 5 END,
  CASE m.mode WHEN 'conservador' THEN 70 WHEN 'agressivo' THEN 55 ELSE 62 END,
  CASE m.mode WHEN 'conservador' THEN 75 WHEN 'agressivo' THEN 55 ELSE 65 END,
  CASE m.mode WHEN 'conservador' THEN 1 WHEN 'agressivo' THEN 3 ELSE 2 END,
  CASE m.mode WHEN 'conservador' THEN 100 WHEN 'agressivo' THEN 200 ELSE 150 END,
  CASE m.mode WHEN 'conservador' THEN 200 WHEN 'agressivo' THEN 400 ELSE 300 END,
  CASE m.mode WHEN 'conservador' THEN 2.5 WHEN 'agressivo' THEN 4.5 ELSE 3.5 END,
  CASE m.mode WHEN 'conservador' THEN 100 WHEN 'agressivo' THEN 600 ELSE 300 END,
  CASE m.mode WHEN 'conservador' THEN 200 WHEN 'agressivo' THEN 1200 ELSE 500 END,
  r.trading_start_time, r.entry_cutoff_time, r.force_close_time
FROM public.b3_simulation_runs r
CROSS JOIN (VALUES ('conservador'),('moderado'),('agressivo')) AS m(mode)
ON CONFLICT (simulation_run_id, mode) DO NOTHING;