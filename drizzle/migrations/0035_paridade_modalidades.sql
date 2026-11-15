-- Paridade entre modalidades (pedido do dono 08/11 e 15/11; substitui "Resultado por
-- combinação" na tela). Tudo por 1 CONTRATO (livreto 137) e só com freio (o que a conta
-- real faria). Duas leituras:
--  1) matriz modalidade × modo: resultado por 1 contrato, ordens e acerto;
--  2) pares de modalidades: nos mesmos pregões, quantas vezes andaram juntas (os dois
--     positivos ou os dois negativos) e a correlação dos resultados diários.

CREATE OR REPLACE FUNCTION public.b3_paridade_matriz(p_user_id uuid, p_de date, p_ate date, p_symbol text)
RETURNS TABLE(variant text, mode text, resultado_1c numeric, ordens integer, acerto_pct numeric, pregoes integer)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  select coalesce(r.variant,'indicador'), o.mode,
    round(sum(o.net_result_brl / nullif(o.quantity,0)), 2),
    count(*)::int,
    round(100.0 * count(*) filter (where o.net_result_brl > 0) / nullif(count(*),0), 1),
    count(distinct (o.exit_time at time zone 'America/Sao_Paulo')::date)::int
  from b3_simulation_orders o join b3_simulation_runs r on r.id = o.simulation_run_id
  where o.user_id = p_user_id and p_user_id = coalesce(auth.uid(), p_user_id)
    and o.status = 'closed' and o.exit_time is not null and not coalesce(o.bloqueado_na_sombra,false)
    and (o.exit_time at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    and left(upper(o.symbol),3) = left(upper(p_symbol),3)
  group by 1,2;
$function$;

CREATE OR REPLACE FUNCTION public.b3_paridade_pares(p_user_id uuid, p_de date, p_ate date, p_symbol text)
RETURNS TABLE(variant_a text, variant_b text, pregoes integer, juntos integer, juntos_pct numeric, correlacao numeric, resultado_a_1c numeric, resultado_b_1c numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  with d as (
    select coalesce(r.variant,'indicador') v, (o.exit_time at time zone 'America/Sao_Paulo')::date dia,
           sum(o.net_result_brl / nullif(o.quantity,0)) res
    from b3_simulation_orders o join b3_simulation_runs r on r.id = o.simulation_run_id
    where o.user_id = p_user_id and p_user_id = coalesce(auth.uid(), p_user_id)
      and o.status = 'closed' and o.exit_time is not null and not coalesce(o.bloqueado_na_sombra,false)
      and (o.exit_time at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      and left(upper(o.symbol),3) = left(upper(p_symbol),3)
    group by 1,2
  )
  select a.v, b.v, count(*)::int,
    count(*) filter (where sign(a.res) = sign(b.res) and a.res <> 0)::int,
    round(100.0 * count(*) filter (where sign(a.res) = sign(b.res) and a.res <> 0) / nullif(count(*),0), 1),
    round(corr(a.res, b.res)::numeric, 2),
    round(sum(a.res), 2), round(sum(b.res), 2)
  from d a join d b on a.dia = b.dia and a.v < b.v
  group by 1,2;
$function$;

REVOKE ALL ON FUNCTION public.b3_paridade_matriz(uuid,date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.b3_paridade_pares(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_paridade_matriz(uuid,date,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.b3_paridade_pares(uuid,date,date,text) TO authenticated, service_role;
