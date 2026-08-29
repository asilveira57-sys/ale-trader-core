CREATE OR REPLACE FUNCTION public.b3_resultado_combinacao(p_de date, p_ate date, p_group text DEFAULT 'trio')
RETURNS TABLE(
  chave text, symbol text, variant text, mode text,
  resultado_brl numeric, ops bigint, ops_pos bigint, hit_rate numeric,
  pregoes bigint, pregoes_pos bigint, pct_pregoes_pos numeric,
  melhor_dia numeric, pior_dia numeric, media_op numeric, score_medio numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      CASE WHEN r.symbol ~ '^[A-Z]{3}[A-Z][0-9]{2}$' THEN substring(upper(r.symbol),1,3)
           ELSE upper(r.symbol) END AS root,
      COALESCE(r.variant,'indicador') AS variant,
      o.mode,
      (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date AS d,
      o.net_result_brl AS res,
      o.entry_score
    FROM public.b3_simulation_orders o
    JOIN public.b3_simulation_runs r ON r.id = o.simulation_run_id
    WHERE o.user_id = auth.uid()
      AND o.status = 'closed' AND o.exit_time IS NOT NULL
      AND (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
  ),
  limpo AS (
    SELECT b.* FROM base b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.b3_intervencoes i
      WHERE i.user_id = auth.uid()
        AND i.trade_date = b.d
        AND COALESCE(i.ambiente,'simulacao') = 'simulacao'
        AND COALESCE(i.anula_dia,true) = true
        AND (upper(i.symbol) = b.root OR b.root LIKE upper(i.symbol) || '%' OR upper(i.symbol) LIKE b.root || '%')
    )
  ),
  k AS (
    SELECT
      CASE lower(coalesce(p_group,'trio'))
        WHEN 'ativo' THEN root
        WHEN 'par' THEN root || '|' || variant
        WHEN 'modalidade' THEN variant
        WHEN 'modo' THEN mode
        ELSE root || '|' || variant || '|' || mode END AS chave,
      CASE WHEN lower(coalesce(p_group,'trio')) IN ('ativo','par','trio') THEN root END AS symbol,
      CASE WHEN lower(coalesce(p_group,'trio')) IN ('par','trio','modalidade') THEN variant END AS variant,
      CASE WHEN lower(coalesce(p_group,'trio')) IN ('trio','modo') THEN mode END AS mode,
      d, res, entry_score
    FROM limpo
  ),
  dia AS (
    SELECT chave, d, sum(res) AS res_dia FROM k GROUP BY 1,2
  ),
  ag AS (
    SELECT chave, min(symbol) AS symbol, min(variant) AS variant, min(mode) AS mode,
           sum(res) AS resultado, count(*) AS ops,
           count(*) FILTER (WHERE res > 0) AS ops_pos,
           avg(entry_score) AS score
    FROM k GROUP BY 1
  ),
  ad AS (
    SELECT chave, count(*) AS pregoes,
           count(*) FILTER (WHERE res_dia > 0) AS pregoes_pos,
           max(res_dia) AS melhor, min(res_dia) AS pior
    FROM dia GROUP BY 1
  )
  SELECT ag.chave, ag.symbol, ag.variant, ag.mode,
         round(ag.resultado,2), ag.ops, ag.ops_pos,
         round(100.0*ag.ops_pos/NULLIF(ag.ops,0),1),
         ad.pregoes, ad.pregoes_pos, round(100.0*ad.pregoes_pos/NULLIF(ad.pregoes,0),1),
         round(ad.melhor,2), round(ad.pior,2),
         round(ag.resultado/NULLIF(ag.ops,0),2), round(ag.score,1)
  FROM ag JOIN ad USING (chave)
$function$;

REVOKE ALL ON FUNCTION public.b3_resultado_combinacao(date, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.b3_resultado_combinacao(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.b3_resultado_combinacao(date, date, text) TO service_role;