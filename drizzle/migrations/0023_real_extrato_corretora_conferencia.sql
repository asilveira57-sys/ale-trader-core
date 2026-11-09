CREATE TABLE public.b3_real_extrato_corretora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pregao date NOT NULL,
  ajuste_day_trade_brl numeric,
  custos_brl numeric,
  irrf_brl numeric,
  deposito_brl numeric,
  saldo_apos_brl numeric,
  origem text NOT NULL CHECK (origem IN ('extrato_pdf','manual')),
  lancado_em timestamptz DEFAULT now(),
  UNIQUE (user_id, pregao)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_real_extrato_corretora TO authenticated;
GRANT ALL ON public.b3_real_extrato_corretora TO service_role;
ALTER TABLE public.b3_real_extrato_corretora ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dono gerencia extrato" ON public.b3_real_extrato_corretora FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Somente leitura: põe lado a lado corretora e sistema, sem corrigir nada.
CREATE OR REPLACE FUNCTION public.b3_real_divergencia()
RETURNS TABLE (pregao date, extrato_lancado boolean, corretora_brl numeric, sistema_brl numeric, diferenca_brl numeric,
  ordens int, fechadas_executor int, fechadas_corretora int, sem_resultado int, custos_corretora_brl numeric, custos_sistema_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH o AS (
    SELECT (coalesce(exit_time, entry_time, created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS d, *
    FROM b3_live_orders WHERE user_id = auth.uid()
      AND status IN ('closed','fechada_pela_corretora','open','pending','fechamento_pendente','closing')
  ), s AS (
    SELECT d, count(*)::int n,
      count(*) FILTER (WHERE status='closed')::int ex,
      count(*) FILTER (WHERE status='fechada_pela_corretora')::int co,
      count(*) FILTER (WHERE net_result_brl IS NULL)::int nul,
      sum(net_result_brl) soma, sum(fees_brl) fees
    FROM o GROUP BY d
  ), e AS (SELECT * FROM b3_real_extrato_corretora WHERE user_id = auth.uid())
  SELECT coalesce(s.d, e.pregao), e.id IS NOT NULL, e.ajuste_day_trade_brl, s.soma,
    CASE WHEN e.id IS NULL OR e.ajuste_day_trade_brl IS NULL THEN NULL ELSE e.ajuste_day_trade_brl - coalesce(s.soma,0) END,
    coalesce(s.n,0), coalesce(s.ex,0), coalesce(s.co,0), coalesce(s.nul,0), e.custos_brl, s.fees
  FROM s FULL JOIN e ON e.pregao = s.d
  ORDER BY abs(CASE WHEN e.id IS NULL OR e.ajuste_day_trade_brl IS NULL THEN NULL ELSE e.ajuste_day_trade_brl - coalesce(s.soma,0) END) DESC NULLS LAST, 1 DESC
$$;
GRANT EXECUTE ON FUNCTION public.b3_real_divergencia() TO authenticated;