CREATE FUNCTION public.b3_ultimos_pregoes(p_user_id uuid, p_n integer DEFAULT 5, p_fim date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date, p_symbols text[] DEFAULT NULL, p_variants text[] DEFAULT NULL, p_modes text[] DEFAULT NULL)
RETURNS TABLE(dia date)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date AS dia
  FROM public.b3_simulation_orders o
  JOIN public.b3_simulation_runs r ON r.id = o.simulation_run_id
  WHERE o.user_id = p_user_id AND p_user_id = auth.uid()
    AND o.status = 'closed'
    AND o.exit_time < ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND (p_symbols IS NULL OR public.b3_raiz(o.symbol) = ANY(p_symbols))
    AND (p_variants IS NULL OR r.variant = ANY(p_variants))
    AND (p_modes IS NULL OR o.mode = ANY(p_modes))
  ORDER BY dia DESC
  LIMIT greatest(1, least(coalesce(p_n, 5), 10));
$$;
REVOKE ALL ON FUNCTION public.b3_ultimos_pregoes(uuid, integer, date, text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_ultimos_pregoes(uuid, integer, date, text[], text[], text[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.b3_ultimos_pregoes(uuid, integer, date, text[], text[], text[]) IS 'Somente leitura: últimas datas com ordens fechadas, até a data selecionada, com os mesmos filtros das três leituras. Nenhum cálculo financeiro.';