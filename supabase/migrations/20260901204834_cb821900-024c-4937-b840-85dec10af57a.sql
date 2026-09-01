ALTER TABLE public.b3_real_execution_state
  ADD COLUMN IF NOT EXISTS peak_min_pct_of_global numeric NOT NULL DEFAULT 0.5;