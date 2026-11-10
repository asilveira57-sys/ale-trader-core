CREATE OR REPLACE FUNCTION public.b3_cockpit_disjuntor_niveis(p_user_id uuid,p_inicio date,p_fim date,p_symbols text[] DEFAULT NULL,p_variants text[] DEFAULT NULL,p_modes text[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE original jsonb; resposta jsonb;
BEGIN
 IF auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
 original := public.b3_cockpit_tres_leituras(p_user_id,p_inicio,p_fim,p_symbols,p_variants,p_modes);
 WITH levels AS MATERIALIZED (
 SELECT DISTINCT r->>'nivel' nivel,r->>'symbol' symbol,r->>'variant' variant FROM jsonb_array_elements(original->'rows') r WHERE r->>'nivel' IN ('total','ativo','modalidade')
 ), days AS (SELECT DISTINCT (d->>'dia')::date dia FROM jsonb_array_elements(original->'daily') d), scenarios AS MATERIALIZED (
 SELECT l.*,d.dia,s.resultado_com_disjuntor_brl,to_jsonb(s)||jsonb_build_object('motivo',s.disparou,'hora',s.hora_disparo_brt) evidence
 FROM levels l CROSS JOIN days d CROSS JOIN LATERAL public.b3_disjuntor_simulado(p_user_id,d.dia,ARRAY[0.25]::numeric[],NULL,NULL,NULL,NULL,CASE WHEN l.nivel='total' THEN NULL ELSE ARRAY[l.symbol] END,CASE WHEN l.nivel='modalidade' THEN ARRAY[l.variant] ELSE NULL END,true) s
 ), period_levels AS (
 SELECT nivel,symbol,variant,coalesce(sum(resultado_com_disjuntor_brl),0) resultado,jsonb_agg(evidence ORDER BY dia DESC) evidence FROM scenarios GROUP BY nivel,symbol,variant
 ), result_rows AS (
 SELECT r || CASE WHEN r->>'nivel'='robo' THEN jsonb_build_object('disjuntor_nivel','modalidade','disjuntor_atribuicao','parcela do robô no cenário da modalidade','disparos',coalesce((SELECT p.evidence FROM period_levels p WHERE p.nivel='modalidade' AND p.symbol=r->>'symbol' AND p.variant=r->>'variant'),'[]'::jsonb)) ELSE jsonb_build_object('disjuntor_nivel',r->>'nivel','com_freio_disjuntor',coalesce((SELECT p.resultado FROM period_levels p WHERE p.nivel=r->>'nivel' AND p.symbol IS NOT DISTINCT FROM r->>'symbol' AND p.variant IS NOT DISTINCT FROM r->>'variant'),0),'disparos',coalesce((SELECT p.evidence FROM period_levels p WHERE p.nivel=r->>'nivel' AND p.symbol IS NOT DISTINCT FROM r->>'symbol' AND p.variant IS NOT DISTINCT FROM r->>'variant'),'[]'::jsonb)) END r FROM jsonb_array_elements(original->'rows') r
 ), result_daily AS (
 SELECT d || jsonb_build_object('disjuntor_nivel',CASE (d->>'gid')::int WHEN 0 THEN 'modalidade' WHEN 1 THEN 'ativo' ELSE 'total' END,'com_freio_disjuntor',coalesce(s.resultado_com_disjuntor_brl,0),'disparos',CASE WHEN s.evidence IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(s.evidence) END) d
 FROM jsonb_array_elements(original->'daily') d LEFT JOIN scenarios s ON s.dia=(d->>'dia')::date AND s.nivel=CASE (d->>'gid')::int WHEN 0 THEN 'modalidade' WHEN 1 THEN 'ativo' ELSE 'total' END AND s.symbol IS NOT DISTINCT FROM d->>'symbol' AND s.variant IS NOT DISTINCT FROM d->>'variant'
 ) SELECT original || jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM result_rows),'daily',(SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM result_daily)) INTO resposta;
 RETURN resposta;
END $$;
REVOKE ALL ON FUNCTION public.b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[]) TO authenticated,service_role;