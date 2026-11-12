-- 0032 — Modalidade e robô herdam o disjuntor DO ATIVO (decisão do dono 12/11/2026 19:18).
-- Antes, a coluna "com freio + disjuntor" de cada modalidade simulava um disjuntor PRÓPRIO da modalidade
-- (limite de 25% do capital da modalidade), que não existe na regra vigente. Com isso as modalidades
-- não somavam o ativo (WDO 12/11: modalidades −7.669 contra ativo +4.750).
-- Agora: modalidade e robô = ordens COM FREIO fechadas até a ordem em que o disjuntor do ativo disparou
-- (ou o dia inteiro, se não disparou). As modalidades somam o ativo, e os ativos somam o total.
-- Somente leitura. Não altera b3_disjuntor_simulado nem b3_cockpit_tres_leituras.

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
  SELECT DISTINCT r->>'symbol' symbol FROM jsonb_array_elements(original->'rows') r WHERE r->>'nivel' = 'ativo'
 ), days AS (SELECT DISTINCT (d->>'dia')::date dia FROM jsonb_array_elements(original->'daily') d),
 cen_base AS MATERIALIZED (
  SELECT l.symbol, d.dia, s.resultado_com_disjuntor_brl, s.ordens_antes, s.disparou, s.hora_disparo_brt,
         to_jsonb(s) || jsonb_build_object('motivo', s.disparou, 'hora', s.hora_disparo_brt) evidence
  FROM levels l CROSS JOIN days d
  CROSS JOIN LATERAL public.b3_disjuntor_simulado(p_user_id, d.dia, ARRAY[0.25]::numeric[], NULL, NULL, NULL, NULL, ARRAY[l.symbol], p_variants, true, p_modes) s
 ),
 -- Ordens COM FREIO, na mesma ordem e com os mesmos filtros da curva do disjuntor do ativo.
 ordens AS MATERIALIZED (
  SELECT x.*, row_number() OVER (PARTITION BY x.dia, x.rz ORDER BY x.exit_time) n
  FROM (
   SELECT (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date dia,
          CASE WHEN upper(o.symbol) ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$' THEN left(upper(o.symbol),3) ELSE upper(o.symbol) END rz,
          coalesce(r.variant,'indicador') variant, o.mode::text mode, o.exit_time, o.net_result_brl
   FROM public.b3_simulation_orders o JOIN public.b3_simulation_runs r ON r.id = o.simulation_run_id
   WHERE o.user_id = p_user_id AND o.status = 'closed' AND o.exit_time IS NOT NULL
     AND coalesce(o.bloqueado_na_sombra,false) = false
     AND o.exit_time >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
     AND o.exit_time <  ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
     AND (p_variants IS NULL OR coalesce(r.variant,'indicador') = ANY(p_variants))
     AND (p_modes IS NULL OR o.mode = ANY(p_modes))
  ) x
 ),
 corte AS MATERIALIZED (
  SELECT o.*, c.disparou, c.hora_disparo_brt, (c.disparou = 'não disparou' OR o.n <= c.ordens_antes) dentro
  FROM ordens o JOIN cen_base c ON c.symbol = o.rz AND c.dia = o.dia
 ),
 parc_dia AS (
  SELECT dia, rz, variant, sum(net_result_brl) com_freio,
         coalesce(sum(net_result_brl) FILTER (WHERE dentro), 0) parcela,
         count(*)::int n_dia, count(*) FILTER (WHERE dentro)::int n_antes,
         max(disparou) disparou, max(hora_disparo_brt) hora
  FROM corte GROUP BY dia, rz, variant
 ),
 parc_modo AS (
  SELECT rz, variant, mode, coalesce(sum(net_result_brl) FILTER (WHERE dentro), 0) parcela FROM corte GROUP BY rz, variant, mode
 ),
 mod_evid AS (
  SELECT dia, rz, variant, parcela,
         jsonb_build_object('dia', dia, 'motivo', disparou, 'disparou', disparou, 'hora', hora, 'hora_disparo_brt', hora,
           'resultado_sem_disjuntor_brl', com_freio, 'resultado_com_disjuntor_brl', parcela, 'diferenca_brl', parcela - com_freio,
           'ordens_no_dia', n_dia, 'ordens_antes', n_antes, 'ordens_evitadas', n_dia - n_antes,
           'atribuicao', 'parcela da modalidade no disjuntor do ativo') evidence
  FROM parc_dia
 ),
 scenarios AS MATERIALIZED (
  SELECT 'ativo'::text nivel, symbol, NULL::text variant, dia, resultado_com_disjuntor_brl, evidence FROM cen_base
  UNION ALL
  SELECT 'modalidade', rz, variant, dia, parcela, evidence FROM mod_evid
  UNION ALL
  SELECT 'total', NULL, NULL, dia, sum(resultado_com_disjuntor_brl),
   jsonb_build_object('dia', dia,
    'motivo', string_agg(symbol || ': ' || (evidence->>'disparou') || coalesce(' às ' || left(evidence->>'hora_disparo_brt',5), ''), ' · ' ORDER BY symbol),
    'hora', NULL, 'disparou', 'soma dos disjuntores por ativo',
    'resultado_com_disjuntor_brl', sum(resultado_com_disjuntor_brl),
    'resultado_sem_disjuntor_brl', sum((evidence->>'resultado_sem_disjuntor_brl')::numeric),
    'diferenca_brl', sum((evidence->>'diferenca_brl')::numeric),
    'ordens_antes', sum((evidence->>'ordens_antes')::int),
    'ordens_evitadas', sum((evidence->>'ordens_evitadas')::int),
    'ordens_no_dia', sum((evidence->>'ordens_no_dia')::int),
    'por_ativo', jsonb_agg(evidence || jsonb_build_object('symbol', symbol) ORDER BY symbol))
  FROM cen_base GROUP BY dia
 ), period_levels AS (
  SELECT nivel, symbol, variant, coalesce(sum(resultado_com_disjuntor_brl),0) resultado, jsonb_agg(evidence ORDER BY dia DESC) evidence
  FROM scenarios GROUP BY nivel, symbol, variant
 ), result_rows AS (
  SELECT r || CASE WHEN r->>'nivel' = 'robo' THEN jsonb_build_object(
      'disjuntor_nivel', 'ativo',
      'disjuntor_atribuicao', 'parcela do robô no disjuntor do ativo',
      'com_freio_disjuntor', coalesce((SELECT p.parcela FROM parc_modo p WHERE p.rz = r->>'symbol' AND p.variant = r->>'variant' AND p.mode = r->>'mode'), 0),
      'disparos', coalesce((SELECT p.evidence FROM period_levels p WHERE p.nivel = 'modalidade' AND p.symbol = r->>'symbol' AND p.variant = r->>'variant'), '[]'::jsonb))
    ELSE jsonb_build_object(
      'disjuntor_atribuicao', CASE r->>'nivel' WHEN 'total' THEN 'soma dos disjuntores por ativo' WHEN 'ativo' THEN 'disjuntor do próprio nível' ELSE 'parcela da modalidade no disjuntor do ativo' END,
      'disjuntor_nivel', r->>'nivel',
      'com_freio_disjuntor', coalesce((SELECT p.resultado FROM period_levels p WHERE p.nivel = r->>'nivel' AND p.symbol IS NOT DISTINCT FROM r->>'symbol' AND p.variant IS NOT DISTINCT FROM r->>'variant'), 0),
      'disparos', coalesce((SELECT p.evidence FROM period_levels p WHERE p.nivel = r->>'nivel' AND p.symbol IS NOT DISTINCT FROM r->>'symbol' AND p.variant IS NOT DISTINCT FROM r->>'variant'), '[]'::jsonb))
    END r
  FROM jsonb_array_elements(original->'rows') r
 ), result_daily AS (
  SELECT d || jsonb_build_object(
    'disjuntor_nivel', CASE (d->>'gid')::int WHEN 0 THEN 'modalidade' WHEN 1 THEN 'ativo' ELSE 'total' END,
    'com_freio_disjuntor', coalesce(s.resultado_com_disjuntor_brl, 0),
    'disparos', CASE WHEN s.evidence IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(s.evidence) END) d
  FROM jsonb_array_elements(original->'daily') d
  LEFT JOIN scenarios s ON s.dia = (d->>'dia')::date
   AND s.nivel = CASE (d->>'gid')::int WHEN 0 THEN 'modalidade' WHEN 1 THEN 'ativo' ELSE 'total' END
   AND s.symbol IS NOT DISTINCT FROM d->>'symbol' AND s.variant IS NOT DISTINCT FROM d->>'variant'
 ) SELECT original || jsonb_build_object('rows', (SELECT coalesce(jsonb_agg(r),'[]'::jsonb) FROM result_rows), 'daily', (SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM result_daily)) INTO resposta;
 RETURN resposta;
END $function$;

CREATE OR REPLACE FUNCTION public.b3_pico_tres_cenarios_dia(p_user_id uuid, p_inicio date, p_fim date, p_symbols text[] DEFAULT NULL::text[], p_variants text[] DEFAULT NULL::text[], p_modes text[] DEFAULT NULL::text[])
 RETURNS TABLE(trade_date date, raiz text, variant text, cenario text, pico_brl numeric, hora_do_pico_brt time without time zone, fechamento_brl numeric, devolveu_brl numeric, ordens integer, disparou text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select (o.exit_time at time zone 'America/Sao_Paulo')::date dia,
           case when upper(o.symbol) ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$' then left(upper(o.symbol),3) else upper(o.symbol) end rz,
           coalesce(r.variant,'indicador') var, o.exit_time, o.net_result_brl, coalesce(o.bloqueado_na_sombra,false) sombra
    from b3_simulation_orders o
    join b3_simulation_runs r on r.id = o.simulation_run_id
    where o.user_id = p_user_id and p_user_id = auth.uid()
      and o.status = 'closed' and o.exit_time is not null
      and o.exit_time >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
      and o.exit_time <  ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
      and (p_variants is null or coalesce(r.variant,'indicador') = any(p_variants))
      and (p_modes is null or o.mode = any(p_modes))
  ),
  filtrada as (
    select f.*, case when not f.sombra then row_number() over (partition by f.dia, f.rz, f.sombra order by f.exit_time) end n_ativo
    from base f where p_symbols is null or f.rz = any(p_symbols)
  ),
  pontos as (
    select dia, rz, var grupo, exit_time, net_result_brl, sombra, n_ativo from filtrada
    union all
    select dia, rz, '(ativo)', exit_time, net_result_brl, sombra, n_ativo from filtrada
  ),
  curva_sem as (
    select dia, rz, grupo, 'sem freio'::text cen, exit_time,
           sum(net_result_brl) over (partition by dia, rz, grupo order by exit_time rows unbounded preceding) acum,
           row_number() over (partition by dia, rz, grupo order by exit_time) n, null::bigint n_ativo
    from pontos
  ),
  curva_com as (
    select dia, rz, grupo, 'com freio'::text cen, exit_time,
           sum(net_result_brl) over (partition by dia, rz, grupo order by exit_time rows unbounded preceding) acum,
           row_number() over (partition by dia, rz, grupo order by exit_time) n, n_ativo
    from pontos where not sombra
  ),
  ativos as (select distinct dia, rz from curva_com),
  -- Um disjuntor só, o do ATIVO (decisão 12/11/2026); a modalidade herda o corte dele.
  disj as (
    select a.dia, a.rz, s.ordens_antes, s.disparou
    from ativos a
    cross join lateral public.b3_disjuntor_simulado(p_user_id, a.dia, ARRAY[0.25]::numeric[], NULL, NULL, NULL, NULL,
      ARRAY[a.rz], p_variants, true, p_modes) s
  ),
  curva_disj as (
    select c.dia, c.rz, c.grupo, 'com disjuntor'::text cen, c.exit_time, c.acum, c.n, c.n_ativo
    from curva_com c join disj d on d.dia = c.dia and d.rz = c.rz
    where d.disparou = 'não disparou' or c.n_ativo <= d.ordens_antes
  ),
  curvas as (
    select * from curva_sem union all select * from curva_com union all select * from curva_disj
  ),
  resumo as (
    select dia, rz, grupo, cen,
           (array_agg(acum order by acum desc, exit_time asc))[1] pico,
           (array_agg(exit_time order by acum desc, exit_time asc))[1] hora_pico,
           (array_agg(acum order by n desc))[1] fechamento,
           count(*)::integer ordens
    from curvas group by dia, rz, grupo, cen
  )
  select r.dia, r.rz, r.grupo, r.cen, round(r.pico,2),
         (r.hora_pico at time zone 'America/Sao_Paulo')::time,
         round(r.fechamento,2), round(r.pico - r.fechamento,2), r.ordens,
         case when r.cen = 'com disjuntor' then d.disparou end
  from resumo r
  left join disj d on d.dia = r.dia and d.rz = r.rz
  order by r.dia desc, r.rz, (r.grupo = '(ativo)') desc, r.grupo,
           case r.cen when 'sem freio' then 1 when 'com freio' then 2 else 3 end;
$function$;

REVOKE ALL ON FUNCTION public.b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_cockpit_disjuntor_niveis(uuid,date,date,text[],text[],text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.b3_pico_tres_cenarios_dia(uuid,date,date,text[],text[],text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_pico_tres_cenarios_dia(uuid,date,date,text[],text[],text[]) TO authenticated, service_role;
