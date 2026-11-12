-- 0029 — Disjuntor simulado por ativo e piso da devolução de pico em % (11/11/2026)
-- Registro no repositório do que foi aplicado direto no banco em 11/11/2026 (livreto 124).
--  * b3_cockpit_disjuntor_niveis: a linha "total" deixa de ser uma chamada sobre a curva
--    agregada e passa a ser a SOMA dos disjuntores de cada ativo (disjuntor_atribuicao =
--    'soma dos disjuntores por ativo'), com a lista por_ativo na evidência diária.
--  * b3_disjuntor_simulado: o piso da devolução de pico deixa de ser R$ fixo (peak_min_brl)
--    e passa a ser peak_min_pct_of_global (padrão 0,5) x limite de perda do cenário;
--    p_piso_pico_brl fica só como override.
-- Corpo copiado com pg_get_functiondef em 12/11/2026 (md5 conferido). Reaplicar não muda nada.

CREATE OR REPLACE FUNCTION public.b3_disjuntor_simulado(p_user_id uuid, p_dia date, p_perdas_pct numeric[] DEFAULT ARRAY[0.25, 0.40, 0.50], p_capital_base numeric DEFAULT NULL::numeric, p_ganho_pct numeric DEFAULT NULL::numeric, p_devolucao_pico_pct numeric DEFAULT NULL::numeric, p_piso_pico_brl numeric DEFAULT NULL::numeric, p_symbols text[] DEFAULT ARRAY['WIN'::text], p_variants text[] DEFAULT NULL::text[], p_com_freio boolean DEFAULT true, p_modes text[] DEFAULT NULL::text[])
 RETURNS TABLE(dia date, com_freio boolean, capital_base_brl numeric, base_origem text, perda_pct numeric, limite_perda_brl numeric, meta_ganho_brl numeric, disparou text, hora_disparo_brt time without time zone, resultado_com_disjuntor_brl numeric, resultado_sem_disjuntor_brl numeric, diferenca_brl numeric, ordens_antes integer, ordens_evitadas integer, ordens_no_dia integer, pior_momento_brl numeric, melhor_momento_brl numeric, frase text)
 LANGUAGE sql
 STABLE
AS $function$
  -- p_com_freio = true  : a curva usa SO as ordens que o freio deixaria passar
  --                       (bloqueado_na_sombra = false). E o cenario REAL, e e
  --                       o que o dono usa — ele nao opera sem freio.
  -- p_com_freio = false : a curva usa TODAS as ordens. E o que o simulado
  --                       realiza, porque na sombra a barrada entra assim mesmo.
  -- Capital automático = capacidade dos robôs habilitados em runs running.
  -- Margem vem exclusivamente de b3_asset_profiles, sem reserva adicional.
  -- Espelha os TRES mecanismos reais de b3_real_execution_state: teto de perda,
  -- meta de ganho e devolucao de pico. Vence o que ocorre PRIMEIRO no tempo.
  -- LIMITACAO: curva do REALIZADO, pela hora de saida. O disjuntor real le o
  -- saldo com flutuante, entao dispara um pouco mais cedo. Cenario conservador.
  with cfg as (
    select coalesce(p_ganho_pct, e.daily_gain_target_pct, 0.80) ganho_pct,
           coalesce(p_devolucao_pico_pct, e.peak_giveback_pct, 0.35) devolucao_pct,
           coalesce(e.peak_min_pct_of_global, 0.5) piso_pct  -- piso = % do stop do cenário (11/11/2026: valor fixo é erro)
    from (select 1 z) x
    left join b3_real_execution_state e on e.user_id = p_user_id
  ),
  filtradas as (
    select o.exit_time, o.net_result_brl
    from b3_simulation_orders o
    join b3_simulation_runs r on r.id = o.simulation_run_id
    where o.user_id = p_user_id and o.status='closed' and o.exit_time is not null
      and (o.exit_time at time zone 'America/Sao_Paulo')::date = p_dia
      and (not p_com_freio or coalesce(o.bloqueado_na_sombra,false) = false)
      and (p_symbols is null or (case when upper(o.symbol) ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$'
             then left(upper(o.symbol),3) else upper(o.symbol) end) = any(p_symbols))
      and (p_variants is null or coalesce(r.variant,'indicador') = any(p_variants)) and (p_modes is null or o.mode = any(p_modes))
  ),
  base as (
    select coalesce(p_capital_base,
      (select sum(c.max_contracts * c.margin_per_contract_brl)
       from public.b3_disjuntor_capacidade(p_user_id,p_symbols,p_variants,p_modes) c), 0) valor,
      case when p_capital_base is not null then 'informado'
           else 'capacidade dos robôs habilitados' end origem
  ),
  acumulada as (
    select exit_time, row_number() over (order by exit_time) n,
           sum(net_result_brl) over (order by exit_time rows unbounded preceding) acum
    from filtradas
  ),
  curva as (
    select exit_time, n, acum,
           max(acum) over (order by n rows unbounded preceding) pico_ate_aqui,
           count(*) over () total
    from acumulada
  ),
  cen as (select unnest(p_perdas_pct) pct),
  marcada as (
    select c.pct, k.n, k.exit_time, k.acum,
      case
        when k.acum <= (-1) * c.pct * b.valor and b.valor > 0 then 'teto de perda'
        when g.ganho_pct * b.valor > 0 and k.acum >= g.ganho_pct * b.valor then 'meta de ganho'
        when k.pico_ate_aqui > 0 and k.pico_ate_aqui >= coalesce(p_piso_pico_brl, g.piso_pct * c.pct * b.valor)
         and k.acum <= k.pico_ate_aqui * (1 - g.devolucao_pct) then 'devolução de pico'
      end gatilho
    from cen c cross join curva k cross join base b cross join cfg g
  ),
  primeiro as (
    select pct, gatilho, exit_time, acum, n,
           row_number() over (partition by pct order by n) rn
    from marcada where gatilho is not null
  ),
  final_dia as (
    select (array_agg(acum order by n desc))[1] acum_final,
           max(acum) melhor, min(acum) pior, max(total) total
    from curva
  )
  select p_dia, p_com_freio, b.valor, b.origem, c.pct,
    round((-1) * c.pct * b.valor, 2),
    round((select ganho_pct from cfg) * b.valor, 2),
    coalesce(pr.gatilho, 'não disparou'),
    (pr.exit_time at time zone 'America/Sao_Paulo')::time,
    round(coalesce(pr.acum, fd.acum_final), 2),
    round(fd.acum_final, 2),
    round(coalesce(pr.acum, fd.acum_final) - fd.acum_final, 2),
    coalesce(pr.n, fd.total)::int,
    (fd.total - coalesce(pr.n, fd.total))::int,
    fd.total::int,
    round(fd.pior,2), round(fd.melhor,2),
    case
      when pr.gatilho is null then 'não disparou — o dia inteiro valeria'
      when coalesce(pr.acum,0) - fd.acum_final > 0
        then pr.gatilho || ' às ' || to_char((pr.exit_time at time zone 'America/Sao_Paulo')::time,'HH24:MI')
             || ' — evitou perder mais R$ ' || b3_brl(coalesce(pr.acum,0) - fd.acum_final)
      when coalesce(pr.acum,0) - fd.acum_final < 0
        then pr.gatilho || ' às ' || to_char((pr.exit_time at time zone 'America/Sao_Paulo')::time,'HH24:MI')
             || ' — deixou de ganhar R$ ' || b3_brl(fd.acum_final - coalesce(pr.acum,0))
      else pr.gatilho || ' — sem diferença'
    end
  from cen c cross join base b cross join final_dia fd
  left join primeiro pr on pr.pct = c.pct and pr.rn = 1
  order by c.pct;
$function$
;

CREATE OR REPLACE FUNCTION public.b3_cockpit_disjuntor_niveis(p_user_id uuid, p_inicio date, p_fim date, p_symbols text[] DEFAULT NULL::text[], p_variants text[] DEFAULT NULL::text[], p_modes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE original jsonb; resposta jsonb;
BEGIN
 IF auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Acesso negado'; END IF;
 original := public.b3_cockpit_tres_leituras(p_user_id,p_inicio,p_fim,p_symbols,p_variants,p_modes);
 WITH levels AS MATERIALIZED (
 SELECT DISTINCT r->>'nivel' nivel,r->>'symbol' symbol,r->>'variant' variant FROM jsonb_array_elements(original->'rows') r WHERE r->>'nivel' IN ('ativo','modalidade')
 ), days AS (SELECT DISTINCT (d->>'dia')::date dia FROM jsonb_array_elements(original->'daily') d), cen_base AS MATERIALIZED (
 SELECT l.*,d.dia,s.resultado_com_disjuntor_brl,to_jsonb(s)||jsonb_build_object('motivo',s.disparou,'hora',s.hora_disparo_brt) evidence
 FROM levels l CROSS JOIN days d CROSS JOIN LATERAL public.b3_disjuntor_simulado(p_user_id,d.dia,ARRAY[0.25]::numeric[],NULL,NULL,NULL,NULL,CASE WHEN l.nivel='total' THEN p_symbols ELSE ARRAY[l.symbol] END,CASE WHEN l.nivel='modalidade' THEN ARRAY[l.variant] ELSE p_variants END,true,p_modes) s
 ), scenarios AS MATERIALIZED (
 SELECT nivel,symbol,variant,dia,resultado_com_disjuntor_brl,evidence FROM cen_base
 UNION ALL
 SELECT 'total',NULL,NULL,dia,sum(resultado_com_disjuntor_brl),
  jsonb_build_object('dia',dia,
   'motivo',string_agg(symbol||': '||(evidence->>'disparou')||coalesce(' às '||left(evidence->>'hora_disparo_brt',5),''),' · ' ORDER BY symbol),
   'hora',NULL,'disparou','soma dos disjuntores por ativo',
   'resultado_com_disjuntor_brl',sum(resultado_com_disjuntor_brl),
   'resultado_sem_disjuntor_brl',sum((evidence->>'resultado_sem_disjuntor_brl')::numeric),
   'diferenca_brl',sum((evidence->>'diferenca_brl')::numeric),
   'ordens_antes',sum((evidence->>'ordens_antes')::int),
   'ordens_evitadas',sum((evidence->>'ordens_evitadas')::int),
   'ordens_no_dia',sum((evidence->>'ordens_no_dia')::int),
   'por_ativo',jsonb_agg(evidence||jsonb_build_object('symbol',symbol) ORDER BY symbol))
 FROM cen_base WHERE nivel='ativo' GROUP BY dia
 ), period_levels AS (
 SELECT nivel,symbol,variant,coalesce(sum(resultado_com_disjuntor_brl),0) resultado,jsonb_agg(evidence ORDER BY dia DESC) evidence FROM scenarios GROUP BY nivel,symbol,variant
 ), result_rows AS (
 SELECT r || CASE WHEN r->>'nivel'='robo' THEN jsonb_build_object('disjuntor_nivel','modalidade','disjuntor_atribuicao','parcela do robô no cenário da modalidade','disparos',coalesce((SELECT p.evidence FROM period_levels p WHERE p.nivel='modalidade' AND p.symbol=r->>'symbol' AND p.variant=r->>'variant'),'[]'::jsonb)) ELSE jsonb_build_object('disjuntor_atribuicao',CASE WHEN r->>'nivel'='total' THEN 'soma dos disjuntores por ativo' ELSE 'disjuntor do próprio nível' END,'disjuntor_nivel',r->>'nivel','com_freio_disjuntor',coalesce((SELECT p.resultado FROM period_levels p WHERE p.nivel=r->>'nivel' AND p.symbol IS NOT DISTINCT FROM r->>'symbol' AND p.variant IS NOT DISTINCT FROM r->>'variant'),0),'disparos',coalesce((SELECT p.evidence FROM period_levels p WHERE p.nivel=r->>'nivel' AND p.symbol IS NOT DISTINCT FROM r->>'symbol' AND p.variant IS NOT DISTINCT FROM r->>'variant'),'[]'::jsonb)) END r FROM jsonb_array_elements(original->'rows') r
 ), result_daily AS (
 SELECT d || jsonb_build_object('disjuntor_nivel',CASE (d->>'gid')::int WHEN 0 THEN 'modalidade' WHEN 1 THEN 'ativo' ELSE 'total' END,'com_freio_disjuntor',coalesce(s.resultado_com_disjuntor_brl,0),'disparos',CASE WHEN s.evidence IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(s.evidence) END) d
 FROM jsonb_array_elements(original->'daily') d LEFT JOIN scenarios s ON s.dia=(d->>'dia')::date AND s.nivel=CASE (d->>'gid')::int WHEN 0 THEN 'modalidade' WHEN 1 THEN 'ativo' ELSE 'total' END AND s.symbol IS NOT DISTINCT FROM d->>'symbol' AND s.variant IS NOT DISTINCT FROM d->>'variant'
 ) SELECT original || jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM result_rows),'daily',(SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM result_daily)) INTO resposta;
 RETURN resposta;
END $function$
;

REVOKE ALL ON FUNCTION public.b3_disjuntor_simulado(uuid,date,numeric[],numeric,numeric,numeric,numeric,text[],text[],boolean,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.b3_disjuntor_simulado(uuid,date,numeric[],numeric,numeric,numeric,numeric,text[],text[],boolean,text[]) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[]) TO authenticated,service_role;
