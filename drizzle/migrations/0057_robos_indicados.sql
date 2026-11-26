-- Lê b3_ordens_1_contrato (regra 1 contrato, migration 0039).
-- 25/11/2026: ranking "Robôs indicados" (pedido do dono). Resultado por 1 contrato,
-- só ordens que valeram (com freio: fora da sombra). Período = últimos N pregões
-- com ordem do ativo, ou intervalo de datas. Pregão = data BRT da entrada.
create or replace function public.b3_robos_indicados(
  p_roots text[] default array['WIN'], p_pregoes int default null,
  p_inicio date default null, p_fim date default null)
returns table(raiz text, variant text, mode text, ordens int, ganhos int,
  resultado numeric, resultado_sem_freio numeric, dias int, dias_positivos int,
  pior_dia numeric, melhor_dia numeric, maior_queda numeric,
  pregoes int, inicio date, fim date)
language sql stable security invoker set search_path = public as $$
with base as (
  select case when o.symbol ~ '^(WIN|WDO|BIT|WEU|ETR|SOL)' then left(o.symbol, 3) else o.symbol end raiz,
         coalesce(r.variant, 'indicador') variant, o.mode,
         (o.entry_time at time zone 'America/Sao_Paulo')::date dia,
         o.net_result_brl res,
         coalesce(o.bloqueado_na_sombra, false) sombra
  from b3_ordens_1_contrato o join b3_simulation_runs r on r.id = o.simulation_run_id
  where o.user_id = auth.uid() and o.status = 'closed' and o.net_result_brl is not null
    and o.entry_time >= coalesce(p_inicio, current_date - 120)::timestamp - interval '1 day'
), b as (select * from base where raiz = any(p_roots)),
dias_ativos as (
  select distinct dia from b
  where (p_inicio is null or dia >= p_inicio) and (p_fim is null or dia <= p_fim)
), escolhidos as (
  select dia from dias_ativos order by dia desc limit coalesce(p_pregoes, 100000)
), janela as (select min(dia) i, max(dia) f, count(*)::int n from escolhidos),
por_dia as (
  select b.raiz, b.variant, b.mode, b.dia,
         sum(b.res) filter (where not b.sombra) r_cf, sum(b.res) r_sf,
         count(*) filter (where not b.sombra) n_cf,
         count(*) filter (where not b.sombra and b.res > 0) g_cf
  from b join escolhidos e on e.dia = b.dia group by 1,2,3,4
), acum as (
  select *, sum(coalesce(r_cf,0)) over w cum from por_dia
  window w as (partition by raiz, variant, mode order by dia)
), dd as (
  select *, cum - greatest(0, max(cum) over (partition by raiz, variant, mode order by dia)) queda from acum
)
select raiz, variant, mode, sum(n_cf)::int, sum(g_cf)::int,
       round(coalesce(sum(r_cf),0), 2), round(sum(r_sf), 2),
       count(*) filter (where n_cf > 0)::int, count(*) filter (where r_cf > 0)::int,
       round(min(r_cf) filter (where n_cf > 0), 2), round(max(r_cf) filter (where n_cf > 0), 2),
       round(least(0, min(queda)), 2),
       (select n from janela), (select i from janela), (select f from janela)
from dd group by 1,2,3
$$;
grant execute on function public.b3_robos_indicados(text[], int, date, date) to authenticated;
