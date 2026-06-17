ALTER TABLE public.committee_decisions
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.trading_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS committee_decisions_session_idx
  ON public.committee_decisions (session_id, created_at DESC);