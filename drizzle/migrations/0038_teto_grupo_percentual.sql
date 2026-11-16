-- Teto do freio de grupo = 25% do capital do grupo (decisão do dono 16/11/2026:
-- "qualquer valor fixado é erro"). O gatilho não reconhecia contrato Z (regex
-- '(V|X|U)\d\d$'), contava runs não-running e, em grupo só experimental ou pausado,
-- voltava ao valor antigo fixo. Agora: raiz por b3_carteira_raiz, só runs running,
-- e sem fallback para valor fixo. Resultado com 1 contrato: WIN 310, WDO 280, BIT 90.

UPDATE b3_grupo_limites SET teto_pct = 0.25 WHERE teto_pct IS DISTINCT FROM 0.25;

CREATE OR REPLACE FUNCTION public.b3_derivar_teto_grupo(p_symbol text, p_variant text)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
declare v_robos int; v_ctr int; v_margem numeric; v_pct numeric; v_novo numeric; v_antigo numeric;
begin
  select coalesce(gl.teto_pct, 0.25), gl.teto_brl into v_pct, v_antigo
    from b3_grupo_limites gl
   where gl.symbol = p_symbol and gl.variant = p_variant;
  if v_pct is null then return null; end if;

  select count(*) filter (where ms.enabled),
         max(coalesce(ms.max_contracts, ru.max_contracts, 1)),
         max(ap.margin_per_contract_brl)
    into v_robos, v_ctr, v_margem
    from b3_simulation_runs ru
    join b3_simulation_mode_settings ms on ms.simulation_run_id = ru.id
    join b3_asset_profiles ap on ap.symbol = ru.symbol
   where ru.status = 'running' and b3_carteira_raiz(ru.symbol) = p_symbol
     and ru.variant = p_variant
     and ru.id not in (select run_id from b3_runs_experimentais);

  -- sem robo habilitado: usa o tamanho nominal do grupo para nao gerar teto zero
  if coalesce(v_robos,0) = 0 then
    select count(*) into v_robos
      from b3_simulation_runs ru
      join b3_simulation_mode_settings ms on ms.simulation_run_id = ru.id
     where ru.status = 'running' and b3_carteira_raiz(ru.symbol) = p_symbol and ru.variant = p_variant;
    v_robos := greatest(coalesce(v_robos,0), 8);
  end if;
  -- 16/11: grupo só com execução experimental (ex.: price_action_sc) ou pausado (ex.: WIN vwap)
  -- não volta mais para o valor antigo fixo: usa a margem do ativo e o contrato configurado.
  if v_margem is null or v_ctr is null then
    select max(coalesce(ms.max_contracts, 1)), max(ap.margin_per_contract_brl) into v_ctr, v_margem
      from b3_simulation_runs ru join b3_simulation_mode_settings ms on ms.simulation_run_id = ru.id
      join b3_asset_profiles ap on ap.symbol = ru.symbol
     where b3_carteira_raiz(ru.symbol) = p_symbol and ru.variant = p_variant and ru.status = 'running';
  end if;
  if v_margem is null then
    select ap.margin_per_contract_brl into v_margem from b3_asset_profiles ap
     where ap.quote_symbol = p_symbol and ap.margin_per_contract_brl is not null order by ap.symbol desc limit 1;
    v_ctr := coalesce(v_ctr, 1);
  end if;
  if v_margem is null or v_ctr is null then return v_antigo; end if;

  v_novo := round(v_pct * v_margem * v_ctr * v_robos);

  if v_novo is distinct from v_antigo then
    update b3_grupo_limites set teto_brl = v_novo
     where symbol = p_symbol and variant = p_variant;
    insert into system_logs (event_type, source, severity, message, technical_data)
    values ('teto_grupo_recalculado','b3_derivar_teto_grupo','info',
      format('Teto do grupo %s/%s: R$ %s -> R$ %s', p_symbol, p_variant, v_antigo, v_novo),
      jsonb_build_object('symbol',p_symbol,'variant',p_variant,'antes',v_antigo,'depois',v_novo,
        'teto_pct',v_pct,'margem',v_margem,'contratos',v_ctr,'robos',v_robos,
        'formula','teto_pct x margem x contratos x robos'));
  end if;
  return v_novo;
end $function$;

SELECT count(*) FROM (SELECT public.b3_derivar_teto_grupo(symbol, variant) FROM b3_grupo_limites) x;
