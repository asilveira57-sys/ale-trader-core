CREATE TABLE IF NOT EXISTS public.b3_real_execution_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  real_enabled boolean NOT NULL DEFAULT true,
  stopped_at timestamptz,
  stopped_reason text,
  stopped_by uuid,
  resumed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.b3_real_execution_state TO authenticated;
GRANT ALL ON public.b3_real_execution_state TO service_role;

ALTER TABLE public.b3_real_execution_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own real execution state" ON public.b3_real_execution_state;
CREATE POLICY "own real execution state" ON public.b3_real_execution_state
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);