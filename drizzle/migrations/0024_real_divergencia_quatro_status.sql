CREATE OR REPLACE FUNCTION public.b3_real_divergencia()
RETURNS TABLE (pregao date, extrato_lancado boolean, corretora_brl numeric, sistema_brl numeric, diferenca_brl numeric,
  ordens int, fechadas_executor int, fechadas_corretora int, sem_resultado int, custos_corretora_brl numeric, custos_sistema_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH o AS (
    SELECT (coalesce(exit_time, entry_time, created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS d, status, net_result_brl, fees_brl
    FROM b3_live_orders WHERE user_id = auth.uid()
      AND status IN ('closed','fechada_pela_corretora','divergente_corretora','irreconciliavel')
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