-- 0031 — Fases 3 e 4 do pedido do dono de 11/11/2026 (aplicadas em 12/11/2026).
-- Somente leitura. Não altera b3_disjuntor_simulado, b3_pico_realizado_dia nem b3_pico_exposicao_dia.
--
-- b3_pico_tres_cenarios_dia: pico realizado do dia em três cenários, por ativo ('(ativo)') e por modalidade.
--   sem freio      = todas as ordens (igual a b3_pico_realizado_dia);
--   com freio      = só ordens com bloqueado_na_sombra = false;
--   com disjuntor  = curva com freio cortada na ordem em que o disjuntor disparou (ordens_antes),
--                    com UMA chamada de b3_disjuntor_simulado no nível exibido (perda 25%, piso em % do cenário).
-- b3_capital_em_risco: capital em risco = robôs habilitados × contratos × margem do ativo (b3_asset_profiles),
--   e com folga (× p_folga), por total / ativo / modalidade, com a conta escrita. Fonte: b3_disjuntor_capacidade.

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
  filtrada as (select * from base where p_symbols is null or rz = any(p_symbols)),
  pontos as (
    select dia, rz, var grupo, exit_time, net_result_brl, sombra from filtrada
    union all
    select dia, rz, '(ativo)', exit_time, net_result_brl, sombra from filtrada
  ),
  curva_sem as (
    select dia, rz, grupo, 'sem freio'::text cen, exit_time,
           sum(net_result_brl) over (partition by dia, rz, grupo order by exit_time rows unbounded preceding) acum,
           row_number() over (partition by dia, rz, grupo order by exit_time) n
    from pontos
  ),
  curva_com as (
    select dia, rz, grupo, 'com freio'::text cen, exit_time,
           sum(net_result_brl) over (partition by dia, rz, grupo order by exit_time rows unbounded preceding) acum,
           row_number() over (partition by dia, rz, grupo order by exit_time) n
    from pontos where not sombra
  ),
  grupos as (select distinct dia, rz, grupo from curva_com),
  disj as (
    select g.dia, g.rz, g.grupo, s.ordens_antes, s.disparou
    from grupos g
    cross join lateral public.b3_disjuntor_simulado(p_user_id, g.dia, ARRAY[0.25]::numeric[], NULL, NULL, NULL, NULL,
      ARRAY[g.rz], case when g.grupo = '(ativo)' then p_variants else ARRAY[g.grupo] end, true, p_modes) s
  ),
  curva_disj as (
    select c.dia, c.rz, c.grupo, 'com disjuntor'::text cen, c.exit_time, c.acum, c.n
    from curva_com c join disj d on d.dia = c.dia and d.rz = c.rz and d.grupo = c.grupo
    where c.n <= d.ordens_antes
  ),
  curvas as (
    select * from curva_sem union all select * from curva_com union all select * from curva_disj
  ),
  resumo as (
    select dia, rz, grupo, cen,
           (array_agg(acum order by acum desc, exit_time asc))[1] pico,
           (array_agg(exit_time order by acum desc, exit_time asc))[1] hora_pico,
           (array_agg(acum order by n desc))[1] fechamento,
           max(n)::integer ordens
    from curvas group by dia, rz, grupo, cen
  )
  select r.dia, r.rz, r.grupo, r.cen, round(r.pico,2),
         (r.hora_pico at time zone 'America/Sao_Paulo')::time,
         round(r.fechamento,2), round(r.pico - r.fechamento,2), r.ordens,
         case when r.cen = 'com disjuntor' then d.disparou end
  from resumo r
  left join disj d on d.dia = r.dia and d.rz = r.rz and d.grupo = r.grupo
  order by r.dia desc, r.rz, (r.grupo = '(ativo)') desc, r.grupo,
           case r.cen when 'sem freio' then 1 when 'com freio' then 2 else 3 end;
$function$;

CREATE OR REPLACE FUNCTION public.b3_capital_em_risco(p_user_id uuid, p_symbols text[] DEFAULT NULL::text[], p_variants text[] DEFAULT NULL::text[], p_modes text[] DEFAULT NULL::text[], p_folga numeric DEFAULT 1.30)
 RETURNS TABLE(nivel text, raiz text, variant text, robos integer, contratos_por_robo integer, contratos integer, margem_por_contrato_brl numeric, capital_em_risco_brl numeric, capital_com_folga_brl numeric, conta text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with c as (
    select * from public.b3_disjuntor_capacidade(p_user_id, p_symbols, p_variants, p_modes)
    where p_user_id = auth.uid()
  ),
  g as (
    select case when grouping(c.symbol) = 1 then 'total' when grouping(c.variant) = 1 then 'ativo' else 'modalidade' end nivel,
           c.symbol rz, c.variant var, count(*)::integer robos,
           max(c.max_contracts)::integer cmax, min(c.max_contracts)::integer cmin, sum(c.max_contracts)::integer contratos,
           max(c.margin_per_contract_brl) mmax, min(c.margin_per_contract_brl) mmin,
           coalesce(sum(c.max_contracts * c.margin_per_contract_brl), 0) cap
    from c group by rollup (c.symbol, c.variant)
  )
  select g.nivel, g.rz, g.var, g.robos,
         case when g.cmax = g.cmin then g.cmax end,
         g.contratos,
         case when g.mmax = g.mmin then g.mmax end,
         round(g.cap, 2), round(g.cap * p_folga, 2),
         case when g.cmax = g.cmin and g.mmax = g.mmin
              then g.robos || ' robôs × ' || g.cmax || ' contratos × R$ ' || public.b3_brl(g.mmax) || ' = R$ ' || public.b3_brl(g.cap)
              else g.robos || ' robôs, ' || g.contratos || ' contratos, cada um × a margem do seu ativo = R$ ' || public.b3_brl(g.cap) end
         || ' · com folga × ' || replace(p_folga::text, '.', ',') || ' = R$ ' || public.b3_brl(g.cap * p_folga)
  from g
  order by (g.nivel = 'total') desc, g.rz, (g.nivel = 'ativo') desc, g.var;
$function$;

REVOKE ALL ON FUNCTION public.b3_pico_tres_cenarios_dia(uuid,date,date,text[],text[],text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_pico_tres_cenarios_dia(uuid,date,date,text[],text[],text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.b3_capital_em_risco(uuid,text[],text[],text[],numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_capital_em_risco(uuid,text[],text[],text[],numeric) TO authenticated, service_role;
