-- Extrato do dinheiro real × extrato da corretora, por pregão (15/11/2026).
-- Medido em 15/11: de 34 pregões com movimento desde 01/09, só 1 bate com a corretora;
-- 27 não têm extrato da corretora lançado, 3 têm ordens fechadas sem resultado apurado,
-- 2 têm movimento na corretora sem ordem no sistema e 1 não bate (06/11: sistema -243,
-- corretora +185). A tela passa a mostrar isso em vez de um total que parece oficial.
CREATE OR REPLACE FUNCTION public.b3_extrato_real_vs_corretora(p_user_id uuid, p_de date, p_ate date)
RETURNS TABLE(pregao date, ordens integer, sem_resultado integer, sistema_brl numeric, corretora_ajuste_brl numeric, corretora_custos_brl numeric, corretora_liquido_brl numeric, diferenca_brl numeric, situacao text)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  -- Extrato do dinheiro real × extrato da corretora, por pregão (15/11). A corretora é a
  -- fonte oficial: o sistema só vale quando bate com ela. Ordem fechada sem resultado
  -- (stop da corretora não apurado) aparece contada, nunca como zero escondido.
  with l as (
    select (exit_time at time zone 'America/Sao_Paulo')::date pregao, count(*)::int n,
           count(*) filter (where net_result_brl is null)::int sem, round(sum(net_result_brl),2) sis
    from b3_live_orders
    where user_id = p_user_id and p_user_id = coalesce(auth.uid(), p_user_id) and exit_time is not null
      and (exit_time at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    group by 1
  ), c as (
    select pregao, sum(ajuste_day_trade_brl) aj, sum(custos_brl) cu
    from b3_real_extrato_corretora
    where user_id = p_user_id and pregao between p_de and p_ate group by 1
  )
  select coalesce(l.pregao, c.pregao), coalesce(l.n,0), coalesce(l.sem,0), l.sis, c.aj, c.cu,
         case when c.pregao is not null then round(coalesce(c.aj,0) + coalesce(c.cu,0), 2) end,
         case when c.pregao is not null and l.pregao is not null then round(coalesce(l.sis,0) - (coalesce(c.aj,0) + coalesce(c.cu,0)), 2) end,
         case
           when c.pregao is null then 'sem extrato da corretora lançado'
           when l.pregao is null then 'corretora tem movimento e o sistema não tem ordem'
           when coalesce(l.sem,0) > 0 then 'há ordens sem resultado apurado'
           when abs(coalesce(l.sis,0) - (coalesce(c.aj,0) + coalesce(c.cu,0))) <= 1 then 'bate'
           else 'não bate'
         end
  from l full join c on c.pregao = l.pregao
  order by 1 desc;
$function$;
REVOKE ALL ON FUNCTION public.b3_extrato_real_vs_corretora(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_extrato_real_vs_corretora(uuid,date,date) TO authenticated, service_role;
