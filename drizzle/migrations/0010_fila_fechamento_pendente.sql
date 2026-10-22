CREATE TABLE public.b3_fechamento_pendente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  run_id uuid,
  mode text,
  symbol text,
  close_reason text,
  attempted_execution_price numeric,
  tentativas integer NOT NULL DEFAULT 2,
  erro text,
  detalhes jsonb,
  status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.b3_fechamento_pendente TO authenticated;
GRANT ALL ON public.b3_fechamento_pendente TO service_role;
ALTER TABLE public.b3_fechamento_pendente ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON public.b3_fechamento_pendente FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);