ALTER TABLE public.b3_real_execution_state
  ADD COLUMN IF NOT EXISTS peak_giveback_pct numeric NOT NULL DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS peak_min_brl numeric NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS public.b3_real_account_peak (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  peak_brl numeric NOT NULL DEFAULT 0,
  peak_at timestamptz,
  last_result_brl numeric NOT NULL DEFAULT 0,
  armed boolean NOT NULL DEFAULT false,
  armed_at timestamptz,
  armed_peak_brl numeric,
  armed_result_brl numeric,
  armed_giveback_brl numeric,
  armed_giveback_pct numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_real_account_peak TO authenticated;
GRANT ALL ON public.b3_real_account_peak TO service_role;

ALTER TABLE public.b3_real_account_peak ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own account peak" ON public.b3_real_account_peak
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_b3_real_account_peak_touch
  BEFORE UPDATE ON public.b3_real_account_peak
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();