-- Pico de capital por 1 contrato por ordem (pedido do dono 18/11/2026, livreto 137).
-- Antes de 13/11 havia ordens de 4 a 10 contratos: 12/11 WIN Indicador aparecia 6.650 (33 contratos),
-- agora 806 (4 ordens simultâneas × margem × 1,30). De 13/11 em diante o valor não muda.
CREATE OR REPLACE FUNCTION public.b3_pico_capital_dia(p_user_id uuid, p_inicio date, p_fim date, p_symbols text[] DEFAULT NULL, p_variants text[] DEFAULT NULL)
RETURNS TABLE(dia date, nivel text, raiz text, variant text, pico_brl numeric, contratos_no_pico integer, hora_pico time)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  with o as (
    select (o.entry_time at time zone 'America/Sao_Paulo')::date dia, b3_carteira_raiz(o.symbol) raiz,
           coalesce(r.variant,'indicador') variant, o.entry_time, coalesce(o.exit_time, now()) exit_time,
           1 q, coalesce(m.margem,0) * 1.30 v
    from b3_simulation_orders o
    join b3_simulation_runs r on r.id = o.simulation_run_id
    left join lateral (select ap.margin_per_contract_brl margem from b3_asset_profiles ap
                       where ap.quote_symbol = b3_carteira_raiz(o.symbol) and ap.margin_per_contract_brl is not null
                       order by ap.symbol desc limit 1) m on true
    where o.user_id = p_user_id and p_user_id = coalesce(auth.uid(), p_user_id)
      and not coalesce(o.bloqueado_na_sombra,false)
      and (o.entry_time at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
      and (p_symbols is null or b3_carteira_raiz(o.symbol) = any(p_symbols))
      and (p_variants is null or coalesce(r.variant,'indicador') = any(p_variants))
  ), niveis as (
    select dia, 'modalidade'::text nivel, raiz, variant, entry_time, exit_time, q, v from o
    union all select dia, 'ativo', raiz, null, entry_time, exit_time, q, v from o
    union all select dia, 'total', null, null, entry_time, exit_time, q, v from o
  ), ev as (
    select dia, nivel, raiz, variant, entry_time ts, 1 tipo, q dq, v dv from niveis
    union all select dia, nivel, raiz, variant, exit_time, 0, -q, -v from niveis
  ), acum as (
    select dia, nivel, raiz, variant, ts, sum(dv) over w brl, sum(dq) over w ctr
    from ev window w as (partition by dia, nivel, raiz, variant order by ts, tipo rows unbounded preceding)
  )
  select distinct on (dia, nivel, raiz, variant) dia, nivel, raiz, variant, round(brl, 2), ctr::int,
         (ts at time zone 'America/Sao_Paulo')::time
  from acum order by dia, nivel, raiz, variant, brl desc, ts;
$function$;
