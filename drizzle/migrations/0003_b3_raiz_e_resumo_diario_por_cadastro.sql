CREATE OR REPLACE FUNCTION public.b3_raiz(simbolo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  select regexp_replace(coalesce(simbolo,''), '[FGHJKMNQUVXZ][0-9]{2}$', '')
$$;

-- Conferência do resumo contra as ordens: por raiz × modalidade × modo.
CREATE OR REPLACE FUNCTION public.b3_conferir_resumo(p_date date, p_log boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE v_n integer; v_cells jsonb;
BEGIN
  WITH o AS (
    SELECT public.b3_raiz(r.symbol) AS symbol, r.variant, so.mode,
           count(*) AS ops, round(coalesce(sum(so.net_result_brl),0),2) AS res
    FROM b3_simulation_orders so JOIN b3_simulation_runs r ON r.id = so.simulation_run_id
    WHERE so.entry_time::date = p_date AND so.exit_time IS NOT NULL
    GROUP BY 1,2,3
  ), d AS (
    SELECT symbol, variant, mode, ops, coalesce(resultado_brl,0) AS res
    FROM b3_diagnostico_dia WHERE trade_date = p_date
  )
  SELECT count(*), jsonb_agg(jsonb_build_object(
           'symbol', coalesce(o.symbol,d.symbol), 'variant', coalesce(o.variant,d.variant),
           'mode', coalesce(o.mode,d.mode),
           'ops_resumo', d.ops, 'ops_ordens', o.ops,
           'res_resumo', d.res, 'res_ordens', o.res))
    INTO v_n, v_cells
  FROM o FULL JOIN d ON d.symbol=o.symbol AND d.variant=o.variant AND d.mode=o.mode
  WHERE coalesce(o.ops,0) <> coalesce(d.ops,0)
     OR abs(coalesce(o.res,0) - coalesce(d.res,0)) > 0.01;

  IF v_n > 0 AND p_log THEN
    INSERT INTO system_logs(event_type, source, message, severity, technical_data)
    VALUES ('b3_resumo_divergente', 'b3_diagnosticar_dia',
            format('Resumo diário de %s não bate com as ordens em %s célula(s)', p_date, v_n),
            'critical', jsonb_build_object('trade_date', p_date, 'celulas', v_cells));
  END IF;
  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.b3_diagnosticar_dia(p_date date)
 RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE v_linhas integer;
BEGIN
  -- Dirigido por cadastro: raízes das execuções vivas + raízes com ordens no dia
  -- (o segundo termo cobre o histórico). Nenhuma lista fixa de contrato.
  WITH raizes AS (
    SELECT DISTINCT public.b3_raiz(symbol) AS raiz FROM b3_simulation_runs WHERE status = 'running'
    UNION
    SELECT DISTINCT public.b3_raiz(r.symbol) FROM b3_simulation_orders o
      JOIN b3_simulation_runs r ON r.id = o.simulation_run_id WHERE o.entry_time::date = p_date
  ),
  -- Configuração POR EXECUÇÃO: casar só por ativo×modalidade×modo duplicava
  -- ordens quando havia duas execuções (08/10 price_action: 32 em vez de 28).
  cfg AS (
    SELECT s.simulation_run_id AS run_id, s.mode, s.stop_pts,
           (s.stop_pts * s.max_contracts * (p.tick_value_brl / nullif(p.tick_size,0)))::numeric AS stop_brl
    FROM b3_simulation_mode_settings s
    JOIN b3_simulation_runs r ON r.id = s.simulation_run_id
    LEFT JOIN b3_asset_profiles p ON p.symbol = r.symbol
  ),
  cons AS (
    SELECT o.id,
           count(*) OVER (PARTITION BY public.b3_raiz(r.symbol), r.variant, o.side, o.entry_price,
                                       date_trunc('minute', o.entry_time)) AS n
    FROM b3_simulation_orders o
    JOIN b3_simulation_runs r ON r.id = o.simulation_run_id
    WHERE o.entry_time::date = p_date
  ),
  ord AS (
    SELECT public.b3_raiz(r.symbol) AS symbol, r.variant, o.mode, o.net_result_brl AS res,
           o.gross_result_points AS pts, o.close_reason,
           (o.entry_time AT TIME ZONE 'America/Sao_Paulo')::time AS h_ent,
           (o.exit_time  AT TIME ZONE 'America/Sao_Paulo')::time AS h_sai,
           o.entry_score, c.n AS consenso, cf.stop_pts, cf.stop_brl
    FROM b3_simulation_orders o
    JOIN b3_simulation_runs r ON r.id = o.simulation_run_id
    JOIN raizes rz ON rz.raiz = public.b3_raiz(r.symbol)
    JOIN cons c ON c.id = o.id
    LEFT JOIN cfg cf ON cf.run_id = o.simulation_run_id AND cf.mode = o.mode
    WHERE o.entry_time::date = p_date AND o.exit_time IS NOT NULL
  ),
  agg AS (
    SELECT o.symbol, o.variant, o.mode,
           coalesce(sum(o.res),0) AS resultado, count(*) AS ops,
           count(*) FILTER (WHERE o.res > 0) AS acertos,
           sum(o.res) FILTER (WHERE o.h_ent < TIME '10:15') AS primeira_hora,
           sum(o.res) FILTER (WHERE o.h_ent >= TIME '10:15') AS resto,
           count(*) FILTER (WHERE o.h_ent >= TIME '10:15') AS ops_resto,
           avg(abs(o.pts) - o.stop_pts) FILTER (WHERE o.close_reason = 'stop') AS estouro,
           avg(o.consenso) AS consenso_medio,
           avg(o.entry_score) AS score_medio,
           extract(epoch FROM (max(o.h_sai) - TIME '09:00'))/60 AS min_ate_fim,
           count(*) FILTER (WHERE o.close_reason = 'trailing_stop') AS n_trail,
           count(*) FILTER (WHERE o.close_reason = 'gain') AS n_gain,
           count(*) FILTER (WHERE o.close_reason = 'force_close') AS n_force,
           avg(o.res) FILTER (WHERE o.close_reason = 'trailing_stop' AND o.res > 0) AS trail_medio,
           max(o.stop_pts) AS stop_pts, max(o.stop_brl) AS stop_brl
    FROM ord o
    GROUP BY o.symbol, o.variant, o.mode
  ),
  saidas AS (
    SELECT symbol, variant, mode, jsonb_object_agg(close_reason, n) AS mapa
    FROM (SELECT symbol, variant, mode, close_reason, count(*) AS n
          FROM ord WHERE close_reason IS NOT NULL GROUP BY 1,2,3,4) t
    GROUP BY symbol, variant, mode
  ),
  interv AS (
    SELECT DISTINCT public.b3_raiz(symbol) AS symbol FROM b3_intervencoes
    WHERE trade_date = p_date AND ambiente = 'simulacao'
  )
  INSERT INTO b3_diagnostico_dia AS d
    (trade_date, symbol, variant, mode, resultado_brl, ops, acertos,
     stop_pts_config, stop_brl_config, primeira_hora_brl, resto_do_dia_brl,
     estouro_stop_medio, saidas, minutos_ate_ultima_op,
     robos_no_sinal_medio, score_medio, diagnostico, gerado_em)
  SELECT p_date, a.symbol, a.variant, a.mode,
         round(a.resultado,2), a.ops, a.acertos,
         a.stop_pts, round(a.stop_brl,2),
         round(coalesce(a.primeira_hora,0),2), round(coalesce(a.resto,0),2),
         round(a.estouro,4), s.mapa, round(a.min_ate_fim)::int,
         round(a.consenso_medio,2), round(a.score_medio,1),
         (SELECT array_remove(ARRAY[
            CASE WHEN coalesce(a.primeira_hora,0) < -2*a.stop_brl
                      AND a.ops_resto > 0 AND coalesce(a.resto,0) > 0
                 THEN format('perdeu R$ %s na abertura e recuperou R$ %s no resto do dia',
                             round(-a.primeira_hora,0), round(a.resto,0)) END,
            CASE WHEN a.ops >= 3 AND a.min_ate_fim < 90 AND a.resultado < -2*a.stop_brl
                 THEN format('queimou R$ %s em %s minutos e parou antes das 10h30',
                             round(-a.resultado,0), round(a.min_ate_fim)) END,
            CASE WHEN a.ops >= 5 AND a.min_ate_fim > 240
                      AND a.acertos::numeric/a.ops < 0.35 AND a.resultado < 0
                 THEN format('operou %s minutos com %s acertos em %s — sangramento lento, nao evento unico',
                             round(a.min_ate_fim), a.acertos, a.ops) END,
            CASE WHEN a.n_trail > a.n_gain AND coalesce(a.trail_medio,0) < 0.5*a.stop_brl
                      AND a.n_trail >= 2
                 THEN format('o trailing fechou %s vezes contra %s no alvo, media de R$ %s contra stop de R$ %s — cortando vencedor cedo',
                             a.n_trail, a.n_gain, round(coalesce(a.trail_medio,0),0), round(a.stop_brl,0)) END,
            CASE WHEN NOT EXISTS (SELECT 1 FROM interv i WHERE i.symbol=a.symbol)
                      AND a.estouro > 0.15*a.stop_pts
                 THEN format('stop atravessado em media %s pontos alem dos %s configurados (%s%% a mais) — apertado para o ruido do ativo',
                             (round(a.estouro,4))::float8, (round(a.stop_pts,4))::float8,
                             round(100*a.estouro/a.stop_pts)) END,
            CASE WHEN a.n_force >= 2
                 THEN format('%s operacoes fecharam no gongo — alvo longe demais para o dia', a.n_force) END,
            CASE WHEN a.ops >= 4 AND a.acertos::numeric/a.ops >= 0.5 AND a.resultado < 0
                 THEN format('acertou %s de %s e mesmo assim perdeu — risco-retorno invertido',
                             a.acertos, a.ops) END,
            CASE WHEN a.consenso_medio >= 4
                 THEN format('entrou junto com %s robos em media; consenso alto acerta menos no historico',
                             round(a.consenso_medio,1)) END,
            CASE WHEN EXISTS (SELECT 1 FROM interv i WHERE i.symbol=a.symbol)
                 THEN 'dia com intervencao neste ativo — diagnosticos que dependem de configuracao foram omitidos' END,
            CASE WHEN a.score_medio IS NULL
                 THEN 'sem entry_score gravado — diagnostico de limiar indisponivel' END
          ], NULL)),
         now()
  FROM agg a
  LEFT JOIN saidas s ON s.symbol=a.symbol AND s.variant=a.variant AND s.mode=a.mode
  ON CONFLICT (trade_date, symbol, variant, mode) DO UPDATE SET
    resultado_brl=EXCLUDED.resultado_brl, ops=EXCLUDED.ops, acertos=EXCLUDED.acertos,
    stop_pts_config=EXCLUDED.stop_pts_config, stop_brl_config=EXCLUDED.stop_brl_config,
    primeira_hora_brl=EXCLUDED.primeira_hora_brl, resto_do_dia_brl=EXCLUDED.resto_do_dia_brl,
    estouro_stop_medio=EXCLUDED.estouro_stop_medio, saidas=EXCLUDED.saidas,
    minutos_ate_ultima_op=EXCLUDED.minutos_ate_ultima_op,
    robos_no_sinal_medio=EXCLUDED.robos_no_sinal_medio, score_medio=EXCLUDED.score_medio,
    diagnostico=EXCLUDED.diagnostico, gerado_em=now()
  WHERE (d.resultado_brl, d.ops, d.acertos) IS DISTINCT FROM (EXCLUDED.resultado_brl, EXCLUDED.ops, EXCLUDED.acertos)
     OR d.diagnostico IS DISTINCT FROM EXCLUDED.diagnostico
     OR d.saidas IS DISTINCT FROM EXCLUDED.saidas;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  PERFORM public.b3_conferir_resumo(p_date, true);
  RETURN v_linhas;
END $function$;