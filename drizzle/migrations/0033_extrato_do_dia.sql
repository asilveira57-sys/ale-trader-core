-- Extrato do dia (pedido do dono 08/11 e 15/11): uma linha por ordem do pregão,
-- com filtro de ativo, modalidade e robô, sem as barradas na sombra por padrão,
-- e com o quanto a ordem CHEGOU A GANHAR (MFE em R$) e quanto DEVOLVEU.
-- Substitui, na tela, o Diagnóstico diário e a Ficha do dia. As funções antigas
-- (b3_ficha_dia_ordens / b3_ficha_dia_resumo) continuam existindo.
-- Valor do ponto = b3_asset_profiles.tick_value_brl (mesma regra do cockpit).

CREATE OR REPLACE FUNCTION public.b3_extrato_dia_ordens(
  p_user_id uuid, p_dia date DEFAULT NULL, p_symbols text[] DEFAULT NULL,
  p_variants text[] DEFAULT NULL, p_modes text[] DEFAULT NULL,
  p_incluir_sombra boolean DEFAULT false, p_limite integer DEFAULT 300, p_offset integer DEFAULT 0)
RETURNS TABLE(hora_brt time, hora_saida_brt time, raiz text, variant text, mode text, apelido text,
  lado text, contratos integer, setup text, entrada numeric, saida numeric, stop numeric, alvo numeric,
  score numeric, confianca numeric, votos integer, resultado_brl numeric, mfe_pts numeric, mae_pts numeric,
  chegou_a_ganhar_brl numeric, chegou_a_perder_brl numeric, devolveu_brl numeric, saiu text,
  close_reason text, barrada_na_sombra boolean, freios_na_sombra text[], confirmacao_exigida_pts numeric,
  preco_confirmacao numeric, geometria jsonb, total_no_recorte integer)
LANGUAGE sql STABLE
AS $function$
  with f as (
    select o.*,
      case when upper(o.symbol) ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$' then left(upper(o.symbol),3) else upper(o.symbol) end rz,
      coalesce(r.variant,'indicador') vr,
      coalesce(ap.apelido, o.mode) apl,
      coalesce(pf.tick_value_brl, 0) pv
    from b3_simulation_orders o
    join b3_simulation_runs r on r.id = o.simulation_run_id
    left join (select distinct c.mode, c.apelido from v_b3_cat_robos c) ap on ap.mode = o.mode
    left join (select distinct on (quote_symbol) quote_symbol, tick_value_brl from b3_asset_profiles order by quote_symbol, symbol desc) pf on pf.quote_symbol = upper(o.symbol) or pf.quote_symbol = left(upper(o.symbol),3)
    where o.user_id = p_user_id
      and p_user_id = coalesce(auth.uid(), p_user_id)  -- sessão só lê os próprios dados
      and (o.entry_time at time zone 'America/Sao_Paulo')::date = coalesce(p_dia, (now() at time zone 'America/Sao_Paulo')::date)
      and (p_variants is null or coalesce(r.variant,'indicador') = any(p_variants))
      and (p_modes is null or o.mode = any(p_modes))
      and (p_incluir_sombra or not coalesce(o.bloqueado_na_sombra,false))
  ), g as (
    select * from f where p_symbols is null or rz = any(p_symbols)
  )
  select (g.entry_time at time zone 'America/Sao_Paulo')::time,
    (g.exit_time at time zone 'America/Sao_Paulo')::time,
    g.rz, g.vr, g.mode, g.apl, g.side, g.quantity::int, g.entry_setup,
    g.entry_price, g.exit_price, g.stop_price, g.target_price,
    g.entry_score, g.entry_confidence, g.entry_approve_votes,
    g.net_result_brl, g.mfe_pts, g.mae_pts,
    round(coalesce(g.mfe_pts,0) * g.pv * g.quantity, 2),
    round(coalesce(g.mae_pts,0) * g.pv * g.quantity, 2),
    case when g.status = 'closed' and g.mfe_pts is not null
      then round(greatest(coalesce(g.mfe_pts,0) * g.pv * g.quantity - coalesce(g.gross_result_brl, g.net_result_brl, 0), 0), 2) end,
    case
      when g.status <> 'closed' then 'ainda aberta'
      when g.net_result_brl is null then 'fechada sem resultado'
      when g.stop_price is not null and g.exit_price is not null
       and abs(g.exit_price - g.stop_price) <= abs(g.stop_price - g.entry_price) * 0.05 then 'stop'
      when g.target_price is not null and g.exit_price is not null
       and abs(g.exit_price - g.target_price) <= abs(g.target_price - g.entry_price) * 0.05 then 'alvo'
      else 'no meio'
    end,
    g.close_reason, coalesce(g.bloqueado_na_sombra,false), g.freios_na_sombra,
    g.confirmacao_exigida_pts, g.preco_confirmacao, g.entrada_geometria,
    (count(*) over ())::int
  from g
  order by g.entry_time
  limit greatest(coalesce(p_limite,300),1) offset greatest(coalesce(p_offset,0),0);
$function$;

CREATE OR REPLACE FUNCTION public.b3_extrato_dia_resumo(
  p_user_id uuid, p_dia date DEFAULT NULL, p_symbols text[] DEFAULT NULL,
  p_variants text[] DEFAULT NULL, p_modes text[] DEFAULT NULL, p_incluir_sombra boolean DEFAULT false)
RETURNS TABLE(ordens integer, fechadas integer, abertas integer, ganhos integer, perdas integer,
  acerto_pct numeric, resultado_brl numeric, chegou_a_ganhar_brl numeric, devolveu_brl numeric,
  saiu_no_alvo integer, saiu_no_stop integer, saiu_no_meio integer, barradas_na_sombra integer)
LANGUAGE sql STABLE
AS $function$
  -- Mesmo recorte da lista (mesma função), para tabela e cabeçalho não divergirem.
  select count(*)::int,
    count(*) filter (where saiu <> 'ainda aberta')::int,
    count(*) filter (where saiu = 'ainda aberta')::int,
    count(*) filter (where resultado_brl > 0)::int,
    count(*) filter (where resultado_brl < 0)::int,
    case when count(*) filter (where resultado_brl is not null) = 0 then null
      else round(100.0 * count(*) filter (where resultado_brl > 0) / count(*) filter (where resultado_brl is not null), 1) end,
    round(coalesce(sum(resultado_brl),0),2),
    round(coalesce(sum(chegou_a_ganhar_brl),0),2),
    round(coalesce(sum(devolveu_brl),0),2),
    count(*) filter (where saiu = 'alvo')::int,
    count(*) filter (where saiu = 'stop')::int,
    count(*) filter (where saiu = 'no meio')::int,
    count(*) filter (where barrada_na_sombra)::int
  from b3_extrato_dia_ordens(p_user_id, p_dia, p_symbols, p_variants, p_modes, p_incluir_sombra, 100000, 0);
$function$;

REVOKE ALL ON FUNCTION public.b3_extrato_dia_ordens(uuid,date,text[],text[],text[],boolean,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.b3_extrato_dia_resumo(uuid,date,text[],text[],text[],boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b3_extrato_dia_ordens(uuid,date,text[],text[],text[],boolean,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.b3_extrato_dia_resumo(uuid,date,text[],text[],text[],boolean) TO authenticated, service_role;
