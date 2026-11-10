ALTER TABLE public.b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS exigir_setup_valido boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.b3_simulation_mode_settings.exigir_setup_valido IS 'Quando true, entrada sem setup nomeado da modalidade (no_valid_setup/vazio) entra so na sombra com freio setup_invalido. Ligado manualmente pelo dono.';

DROP FUNCTION public.b3_ficha_dia_ordens(uuid, date, text[], text[], integer, integer);
CREATE FUNCTION public.b3_ficha_dia_ordens(p_user_id uuid, p_dia date DEFAULT NULL::date, p_symbols text[] DEFAULT NULL::text[], p_variants text[] DEFAULT NULL::text[], p_limite integer DEFAULT 900, p_offset integer DEFAULT 0)
 RETURNS TABLE(hora_brt time without time zone, raiz text, variant text, mode text, apelido text, lado text, contratos integer, setup text, entrada numeric, stop numeric, alvo numeric, score numeric, confianca numeric, votos integer, resultado_brl numeric, mfe_pts numeric, mae_pts numeric, saiu text, barrada_na_sombra boolean, confirmacao_exigida_pts numeric, preco_confirmacao numeric, geometria jsonb, total_no_recorte integer, freios_na_sombra text[])
 LANGUAGE sql
 STABLE
AS $function$
  with f as (
    select
      (o.entry_time at time zone 'America/Sao_Paulo')::time h,
      case when upper(o.symbol) ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$'
           then left(upper(o.symbol),3) else upper(o.symbol) end rz,
      coalesce(r.variant,'indicador') vr, o.mode md,
      coalesce(ap.apelido, o.mode) ap,
      o.side, o.quantity, o.entry_setup,
      o.entry_price, o.stop_price, o.target_price,
      o.entry_score, o.entry_confidence, o.entry_approve_votes,
      o.net_result_brl, o.mfe_pts, o.mae_pts, o.status, o.exit_price,
      coalesce(o.bloqueado_na_sombra,false) barrada,
      o.confirmacao_exigida_pts, o.preco_confirmacao, o.entrada_geometria,
      o.entry_time, o.freios_na_sombra fz
    from b3_simulation_orders o
    join b3_simulation_runs r on r.id = o.simulation_run_id
    left join (select distinct c.mode, c.apelido from v_b3_cat_robos c) ap on ap.mode = o.mode
    where o.user_id = p_user_id
      and (o.entry_time at time zone 'America/Sao_Paulo')::date
          = coalesce(p_dia, (now() at time zone 'America/Sao_Paulo')::date)
      and (p_symbols is null or
           (case when upper(o.symbol) ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$'
                 then left(upper(o.symbol),3) else upper(o.symbol) end) = any(p_symbols))
      and (p_variants is null or coalesce(r.variant,'indicador') = any(p_variants))
  )
  select f.h, f.rz, f.vr, f.md, f.ap, f.side, f.quantity::int, f.entry_setup,
    f.entry_price, f.stop_price, f.target_price,
    f.entry_score, f.entry_confidence, f.entry_approve_votes,
    f.net_result_brl, f.mfe_pts, f.mae_pts,
    case
      when f.status <> 'closed' then 'ainda aberta'
      when f.net_result_brl is null then 'fechada sem resultado'
      when f.stop_price is not null and f.exit_price is not null
       and abs(f.exit_price - f.stop_price) <= abs(f.stop_price - f.entry_price) * 0.05 then 'stop'
      when f.target_price is not null and f.exit_price is not null
       and abs(f.exit_price - f.target_price) <= abs(f.target_price - f.entry_price) * 0.05 then 'alvo'
      else 'no meio'
    end,
    f.barrada, f.confirmacao_exigida_pts, f.preco_confirmacao, f.entrada_geometria,
    (count(*) over ())::int, f.fz
  from f
  order by f.entry_time
  limit greatest(coalesce(p_limite,900), 1) offset greatest(coalesce(p_offset,0), 0);
$function$;
GRANT EXECUTE ON FUNCTION public.b3_ficha_dia_ordens(uuid, date, text[], text[], integer, integer) TO authenticated;