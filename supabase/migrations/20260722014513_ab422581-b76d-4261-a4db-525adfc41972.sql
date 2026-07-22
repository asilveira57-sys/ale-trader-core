
ALTER TABLE public.b3_simulation_runs
  ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT 'WINQ26',
  ADD COLUMN IF NOT EXISTS session_date DATE,
  ADD COLUMN IF NOT EXISTS session_day_id UUID;

-- Backfill: mesma (user, symbol, data local BR) => mesmo session_day_id
WITH grouped AS (
  SELECT user_id, symbol,
         ((started_at AT TIME ZONE 'America/Sao_Paulo')::date) AS sd,
         gen_random_uuid() AS sid
  FROM public.b3_simulation_runs
  WHERE session_day_id IS NULL
  GROUP BY user_id, symbol, ((started_at AT TIME ZONE 'America/Sao_Paulo')::date)
)
UPDATE public.b3_simulation_runs r
SET session_date = g.sd,
    session_day_id = g.sid
FROM grouped g
WHERE r.user_id = g.user_id
  AND r.symbol = g.symbol
  AND ((r.started_at AT TIME ZONE 'America/Sao_Paulo')::date) = g.sd
  AND r.session_day_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_b3_sim_runs_session_day
  ON public.b3_simulation_runs (user_id, symbol, session_date);
CREATE INDEX IF NOT EXISTS idx_b3_sim_runs_session_day_id
  ON public.b3_simulation_runs (session_day_id);
