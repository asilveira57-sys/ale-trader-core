CREATE TABLE public.b3_mt5_account_state (
  user_id uuid NOT NULL PRIMARY KEY,
  reported_at timestamptz NOT NULL DEFAULT now(),
  balance numeric,
  equity numeric,
  free_margin numeric,
  positions jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_login text,
  server_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.b3_mt5_account_state TO authenticated;
GRANT ALL ON public.b3_mt5_account_state TO service_role;

ALTER TABLE public.b3_mt5_account_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own account state read" ON public.b3_mt5_account_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());