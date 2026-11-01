CREATE OR REPLACE FUNCTION public.b3_cockpit_tres_leituras(p_user_id uuid,p_inicio date,p_fim date,p_symbols text[] DEFAULT NULL,p_variants text[] DEFAULT NULL,p_modes text[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
WITH catalog AS MATERIALIZED (
 SELECT DISTINCT public.b3_raiz(r.symbol) symbol,coalesce(r.variant,'indicador') variant,s.mode
 FROM public.b3_simulation_runs r JOIN public.b3_simulation_mode_settings s ON s.simulation_run_id=r.id
 WHERE r.user_id=p_user_id AND (p_symbols IS NULL OR public.b3_raiz(r.symbol)=ANY(p_symbols)) AND (p_variants IS NULL OR r.variant=ANY(p_variants)) AND (p_modes IS NULL OR s.mode=ANY(p_modes))
), base AS MATERIALIZED (
 SELECT o.*,public.b3_raiz(o.symbol) raiz,coalesce(r.variant,'indicador') variant,(o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date dia,
 CASE WHEN o.status<>'closed' THEN 'ainda aberta' WHEN o.net_result_brl IS NULL THEN 'fechada sem resultado'
 WHEN o.stop_price IS NOT NULL AND o.exit_price IS NOT NULL AND abs(o.exit_price-o.stop_price)<=abs(o.stop_price-o.entry_price)*0.05 THEN 'stop'
 WHEN o.target_price IS NOT NULL AND o.exit_price IS NOT NULL AND abs(o.exit_price-o.target_price)<=abs(o.target_price-o.entry_price)*0.05 THEN 'alvo' ELSE 'no meio' END saiu
 FROM public.b3_simulation_orders o JOIN public.b3_simulation_runs r ON r.id=o.simulation_run_id
 WHERE o.user_id=p_user_id AND o.status='closed' AND o.exit_time >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo') AND o.exit_time < ((p_fim+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
 AND (p_symbols IS NULL OR public.b3_raiz(o.symbol)=ANY(p_symbols)) AND (p_variants IS NULL OR r.variant=ANY(p_variants)) AND (p_modes IS NULL OR o.mode=ANY(p_modes))
), days AS (SELECT DISTINCT dia,raiz,variant FROM base), scenarios AS MATERIALIZED (
 SELECT d.raiz,d.variant,s.* FROM days d CROSS JOIN LATERAL public.b3_disjuntor_simulado(p_user_id,d.dia,ARRAY[0.25]::numeric[],NULL,NULL,NULL,NULL,ARRAY[d.raiz],ARRAY[d.variant],true) s
), ranked AS MATERIALIZED (
 SELECT b.*,row_number() OVER(PARTITION BY b.raiz,b.variant,b.dia ORDER BY b.exit_time) saida_n
 FROM base b WHERE coalesce(b.bloqueado_na_sombra,false)=false
), marked AS MATERIALIZED (
 SELECT b.*,s.disparou,s.hora_disparo_brt,s.ordens_antes,
 CASE WHEN coalesce(b.bloqueado_na_sombra,false)=false AND (s.disparou='não disparou' OR rk.saida_n<=s.ordens_antes) THEN b.net_result_brl ELSE 0 END cfd
 FROM base b LEFT JOIN ranked rk ON rk.id=b.id LEFT JOIN scenarios s ON s.dia=b.dia AND s.raiz=b.raiz AND s.variant=b.variant
), agg AS (
 SELECT raiz symbol,variant,mode,grouping(raiz,variant,mode) gid,
 count(*)::int ordens,count(*) FILTER(WHERE net_result_brl>0)::int ganhos,count(*) FILTER(WHERE net_result_brl<0)::int perdas,
 round(100.0*count(*) FILTER(WHERE net_result_brl>0)/nullif(count(net_result_brl),0),1) acerto_pct,
 count(*) FILTER(WHERE coalesce(bloqueado_na_sombra,false))::int barradas,
 count(*) FILTER(WHERE saiu='alvo')::int saiu_no_alvo,count(*) FILTER(WHERE saiu='stop')::int saiu_no_stop,count(*) FILTER(WHERE saiu='no meio')::int saiu_no_meio,
 coalesce(sum(net_result_brl),0) sem_freio,coalesce(sum(net_result_brl) FILTER(WHERE coalesce(bloqueado_na_sombra,false)=false),0) com_freio,coalesce(sum(cfd),0) com_freio_disjuntor
 FROM marked GROUP BY GROUPING SETS ((raiz,variant,mode),(raiz,variant),(raiz),())
), curve AS (
 SELECT raiz,variant,mode,dia,exit_time,sum(net_result_brl) OVER(PARTITION BY raiz,variant,mode,dia ORDER BY exit_time,id ROWS UNBOUNDED PRECEDING) acumulado FROM base
), peaks AS (SELECT DISTINCT ON(raiz,variant,mode) raiz,variant,mode,dia pico_data,(exit_time AT TIME ZONE 'America/Sao_Paulo')::time pico_hora,acumulado pico_lucro FROM curve ORDER BY raiz,variant,mode,acumulado DESC,exit_time),
rows AS (
 SELECT jsonb_build_object('symbol',c.symbol,'variant',c.variant,'mode',c.mode,'nivel','robo','ordens',coalesce(a.ordens,0),'ganhos',coalesce(a.ganhos,0),'perdas',coalesce(a.perdas,0),'acerto_pct',a.acerto_pct,'barradas',coalesce(a.barradas,0),'saiu_no_alvo',coalesce(a.saiu_no_alvo,0),'saiu_no_stop',coalesce(a.saiu_no_stop,0),'saiu_no_meio',coalesce(a.saiu_no_meio,0),'sem_freio',coalesce(a.sem_freio,0),'com_freio',coalesce(a.com_freio,0),'com_freio_disjuntor',coalesce(a.com_freio_disjuntor,0),'frase',CASE WHEN coalesce(a.barradas,0)=0 THEN 'não acionado' WHEN a.com_freio>a.sem_freio THEN 'reduziu o prejuízo em R$ '||public.b3_brl(a.com_freio-a.sem_freio) WHEN a.com_freio<a.sem_freio THEN 'custou R$ '||public.b3_brl(a.sem_freio-a.com_freio) ELSE 'sem efeito' END,'pico_lucro',p.pico_lucro,'pico_data',p.pico_data,'pico_hora',p.pico_hora,'disparos',(SELECT coalesce(jsonb_agg(jsonb_build_object('dia',s.dia,'motivo',s.disparou,'hora',s.hora_disparo_brt,'ordens_antes',s.ordens_antes,'ordens_no_dia',s.ordens_no_dia) ORDER BY s.dia),'[]'::jsonb) FROM scenarios s WHERE s.raiz=c.symbol AND s.variant=c.variant)) row
 FROM catalog c LEFT JOIN agg a ON a.gid=0 AND a.symbol=c.symbol AND a.variant=c.variant AND a.mode=c.mode LEFT JOIN peaks p ON p.raiz=c.symbol AND p.variant=c.variant AND p.mode=c.mode
 UNION ALL
 SELECT to_jsonb(a)||jsonb_build_object('com_freio_disjuntor',(SELECT coalesce(sum(s.resultado_com_disjuntor_brl),0) FROM scenarios s WHERE (a.symbol IS NULL OR s.raiz=a.symbol) AND (a.variant IS NULL OR s.variant=a.variant)),'nivel',CASE gid WHEN 1 THEN 'modalidade' WHEN 3 THEN 'ativo' ELSE 'total' END,'frase',CASE WHEN barradas=0 THEN 'não acionado' WHEN com_freio>sem_freio THEN 'reduziu o prejuízo em R$ '||public.b3_brl(com_freio-sem_freio) WHEN com_freio<sem_freio THEN 'custou R$ '||public.b3_brl(sem_freio-com_freio) ELSE 'sem efeito' END) FROM agg a WHERE gid<>0
 UNION ALL
 SELECT jsonb_build_object('symbol',c.symbol,'variant',c.variant,'mode',NULL,'nivel','modalidade','ordens',0,'ganhos',0,'perdas',0,'acerto_pct',NULL,'barradas',0,'sem_freio',0,'com_freio',0,'com_freio_disjuntor',0,'frase','não acionado') FROM (SELECT DISTINCT symbol,variant FROM catalog) c WHERE NOT EXISTS(SELECT 1 FROM agg a WHERE a.gid=1 AND a.symbol=c.symbol AND a.variant=c.variant)
 UNION ALL
 SELECT jsonb_build_object('symbol',c.symbol,'variant',NULL,'mode',NULL,'nivel','ativo','ordens',0,'ganhos',0,'perdas',0,'acerto_pct',NULL,'barradas',0,'sem_freio',0,'com_freio',0,'com_freio_disjuntor',0,'frase','não acionado') FROM (SELECT DISTINCT symbol FROM catalog) c WHERE NOT EXISTS(SELECT 1 FROM agg a WHERE a.gid=3 AND a.symbol=c.symbol)
), daily AS (
 SELECT dia,raiz symbol,variant,grouping(raiz,variant) gid,count(*)::int ordens,count(*) FILTER(WHERE net_result_brl>0)::int ganhos,count(*) FILTER(WHERE net_result_brl<0)::int perdas,count(*) FILTER(WHERE coalesce(bloqueado_na_sombra,false))::int barradas,coalesce(sum(net_result_brl),0) sem_freio,coalesce(sum(net_result_brl) FILTER(WHERE coalesce(bloqueado_na_sombra,false)=false),0) com_freio,coalesce(sum(cfd),0) com_freio_disjuntor FROM marked GROUP BY GROUPING SETS ((dia,raiz,variant),(dia,raiz),(dia))
)
SELECT jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(row),'[]'::jsonb) FROM rows),'daily',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('com_freio_disjuntor',(SELECT coalesce(sum(s.resultado_com_disjuntor_brl),0) FROM scenarios s WHERE s.dia=d.dia AND (d.symbol IS NULL OR s.raiz=d.symbol) AND (d.variant IS NULL OR s.variant=d.variant)))),'[]'::jsonb) FROM daily d),'start',p_inicio,'end',p_fim);
$$;
REVOKE ALL ON FUNCTION public.b3_cockpit_tres_leituras(uuid,date,date,text[],text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_cockpit_tres_leituras(uuid,date,date,text[],text[],text[]) TO authenticated,service_role;