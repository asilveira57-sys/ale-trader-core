
ALTER TABLE public.b3_mt5sim_robots
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS cooldown_s integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;

ALTER TABLE public.b3_mt5sim_robots
  DROP CONSTRAINT IF EXISTS b3_mt5sim_robots_mode_chk;
ALTER TABLE public.b3_mt5sim_robots
  ADD CONSTRAINT b3_mt5sim_robots_mode_chk CHECK (mode IN ('manual','auto','paused'));
