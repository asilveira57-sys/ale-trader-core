CREATE TABLE public.b3_marco_mudanca (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), data date NOT NULL, titulo text NOT NULL CHECK(length(trim(titulo)) BETWEEN 1 AND 100), descricao text NOT NULL, escopo text NOT NULL CHECK(escopo IN ('global','ativo','modalidade')), symbol text, variant text, criado_em timestamptz DEFAULT now(), CHECK (escopo='global' OR symbol IS NOT NULL), CHECK (escopo<>'modalidade' OR variant IS NOT NULL));
GRANT SELECT, INSERT, UPDATE ON public.b3_marco_mudanca TO authenticated;
GRANT ALL ON public.b3_marco_mudanca TO service_role;
ALTER TABLE public.b3_marco_mudanca ENABLE ROW LEVEL SECURITY;
CREATE POLICY marco_read ON public.b3_marco_mudanca FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY marco_insert ON public.b3_marco_mudanca FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY marco_update ON public.b3_marco_mudanca FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE INDEX b3_marco_user_data ON public.b3_marco_mudanca(user_id,data);
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
), marked AS MATERIALIZED (
 SELECT b.*,s.disparou,s.hora_disparo_brt,s.ordens_antes,
 CASE WHEN coalesce(b.bloqueado_na_sombra,false)=false AND (s.disparou='não disparou' OR (b.exit_time AT TIME ZONE 'America/Sao_Paulo')::time<=s.hora_disparo_brt) THEN b.net_result_brl ELSE 0 END cfd
 FROM base b LEFT JOIN scenarios s ON s.dia=b.dia AND s.raiz=b.raiz AND s.variant=b.variant
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
 SELECT to_jsonb(a)||jsonb_build_object('nivel',CASE gid WHEN 1 THEN 'modalidade' WHEN 3 THEN 'ativo' ELSE 'total' END,'frase',CASE WHEN barradas=0 THEN 'não acionado' WHEN com_freio>sem_freio THEN 'reduziu o prejuízo em R$ '||public.b3_brl(com_freio-sem_freio) WHEN com_freio<sem_freio THEN 'custou R$ '||public.b3_brl(sem_freio-com_freio) ELSE 'sem efeito' END) FROM agg a WHERE gid<>0
), daily AS (
 SELECT dia,raiz symbol,variant,grouping(raiz,variant) gid,count(*)::int ordens,count(*) FILTER(WHERE net_result_brl>0)::int ganhos,count(*) FILTER(WHERE net_result_brl<0)::int perdas,count(*) FILTER(WHERE coalesce(bloqueado_na_sombra,false))::int barradas,coalesce(sum(net_result_brl),0) sem_freio,coalesce(sum(net_result_brl) FILTER(WHERE coalesce(bloqueado_na_sombra,false)=false),0) com_freio,coalesce(sum(cfd),0) com_freio_disjuntor FROM marked GROUP BY GROUPING SETS ((dia,raiz,variant),(dia,raiz),(dia))
)
SELECT jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(row),'[]'::jsonb) FROM rows),'daily',(SELECT coalesce(jsonb_agg(to_jsonb(daily)),'[]'::jsonb) FROM daily),'start',p_inicio,'end',p_fim);
$$;
REVOKE ALL ON FUNCTION public.b3_cockpit_tres_leituras(uuid,date,date,text[],text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_cockpit_tres_leituras(uuid,date,date,text[],text[],text[]) TO authenticated,service_role;