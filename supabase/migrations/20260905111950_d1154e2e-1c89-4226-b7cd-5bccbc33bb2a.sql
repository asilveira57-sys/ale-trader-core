CREATE TABLE public.b3_engine_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  simulation_run_id uuid NOT NULL REFERENCES public.b3_simulation_runs(id) ON DELETE CASCADE,
  symbol text,
  variant text,
  trade_date date,
  engine_audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  write_sigs jsonb NOT NULL DEFAULT '{}'::jsonb,
  tick_guard jsonb,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_snapshot_id uuid,
  market_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b3_engine_state_run_uk UNIQUE (user_id, simulation_run_id)
);

COMMENT ON TABLE public.b3_engine_state IS 'Estado CORRENTE do motor por execucao (user_id + simulation_run_id). Atualizada, nunca acrescentada. Substitui as chaves engine_audit/write_sigs/tick_guard que viviam em b3_simulation_market_snapshots.extra.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_engine_state TO authenticated;
GRANT ALL ON public.b3_engine_state TO service_role;

ALTER TABLE public.b3_engine_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own engine state"
  ON public.b3_engine_state FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX b3_engine_state_user_symbol_idx ON public.b3_engine_state (user_id, symbol, variant);

CREATE TRIGGER b3_engine_state_touch
  BEFORE UPDATE ON public.b3_engine_state
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();