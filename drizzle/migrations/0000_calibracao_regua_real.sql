DROP FUNCTION IF EXISTS public.b3_calibrar_limites(integer);
CREATE FUNCTION public.b3_calibrar_limites(p_dias integer DEFAULT 60, p_semana date DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_semana date := coalesce(p_semana, (now() at time zone 'America/Sao_Paulo')::date);
  v_fim timestamptz := ((v_semana + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_linhas int;
  v_pulados jsonb;
BEGIN
  -- mult_atual = b3_simulation_mode_settings.daily_stop_mult (run x mode). Nunca constante.
  -- Robo cujo multiplicador real nao pode ser determinado (runs com valores diferentes
  -- ou nulo) e PULADO e registrado em system_logs. Linha com sugerido = atual nao e gravada.
  DELETE FROM b3_calibracao_semanal WHERE semana_ref = v_semana AND aplicado = false;

  WITH base AS (
    SELECT o.id, o.simulation_run_id AS run, o.mode, r.symbol, r.variant,
           (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           o.exit_time, o.net_result_brl AS res,
           s.stop_pts * ap.tick_value_brl * s.max_contracts AS um_stop,
           s.daily_stop_mult AS mult_real
    FROM b3_simulation_orders o
    JOIN b3_simulation_runs r ON r.id = o.simulation_run_id
    JOIN b3_asset_profiles ap ON ap.symbol = r.symbol
    JOIN b3_simulation_mode_settings s ON s.simulation_run_id = r.id AND s.mode = o.mode
    WHERE o.status = 'closed' AND o.net_result_brl IS NOT NULL
      AND s.stop_pts > 0 AND s.max_contracts > 0
      AND o.exit_time >= v_fim - (p_dias || ' days')::interval
      AND o.exit_time < v_fim
  ),
  real_mult AS (
    SELECT symbol, variant, mode,
           CASE WHEN count(DISTINCT mult_real) = 1 AND bool_and(mult_real IS NOT NULL)
                THEN min(mult_real) END AS mult_atual,
           array_agg(DISTINCT mult_real) AS vistos
    FROM base GROUP BY symbol, variant, mode
  ),
  mult AS (SELECT DISTINCT n FROM (
             SELECT unnest(ARRAY[1.5,2.0,2.5,3.0,3.5,4.0,99.0]::numeric[]) AS n
             UNION SELECT mult_atual FROM real_mult WHERE mult_atual IS NOT NULL) x),
  acum AS (
    SELECT b.*, m.n,
           sum(b.res) OVER (PARTITION BY b.run, b.mode, b.dia, m.n
                            ORDER BY b.exit_time, b.id
                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ate_aqui
    FROM base b CROSS JOIN mult m
  ),
  corte AS (
    SELECT *, min(CASE WHEN ate_aqui <= -(n * um_stop) THEN exit_time END)
                OVER (PARTITION BY run, mode, dia, n) AS bate
    FROM acum
  ),
  por_mult AS (
    SELECT symbol, variant, mode, n,
           sum(res) FILTER (WHERE bate IS NULL OR exit_time <= bate) AS resultado,
           count(DISTINCT dia) AS pregoes,
           count(DISTINCT CASE WHEN bate IS NOT NULL THEN mode || dia::text END) AS dias_afetados
    FROM corte GROUP BY symbol, variant, mode, n
  ),
  efeito_dia AS (
    SELECT symbol, variant, mode, n, dia,
           sum(res) FILTER (WHERE bate IS NULL OR exit_time <= bate) - sum(res) AS ef
    FROM corte GROUP BY symbol, variant, mode, n, dia
    HAVING min(bate) IS NOT NULL
  ),
  concentra AS (
    SELECT symbol, variant, mode, n,
           sum(abs(ef)) AS total_abs,
           sum(abs(ef)) FILTER (WHERE rk <= 3) AS top3_abs
    FROM (SELECT *, row_number() OVER (PARTITION BY symbol,variant,mode,n ORDER BY abs(ef) DESC) AS rk
          FROM efeito_dia) x
    GROUP BY symbol, variant, mode, n
  ),
  atual AS (SELECT p.symbol, p.variant, p.mode, rm.mult_atual, p.resultado AS res_atual
            FROM por_mult p JOIN real_mult rm USING (symbol, variant, mode)
            WHERE rm.mult_atual IS NOT NULL AND p.n = rm.mult_atual),
  melhor AS (
    SELECT DISTINCT ON (p.symbol, p.variant, p.mode)
           p.symbol, p.variant, p.mode, p.n, p.resultado, p.pregoes, p.dias_afetados,
           CASE WHEN c.total_abs > 0 THEN round(c.top3_abs / c.total_abs, 3) END AS peso_top3
    FROM por_mult p
    LEFT JOIN concentra c USING (symbol, variant, mode, n)
    WHERE p.n < 99
    ORDER BY p.symbol, p.variant, p.mode, p.resultado DESC
  )
  INSERT INTO b3_calibracao_semanal
    (semana_ref, symbol, variant, mode, apelido, mult_atual, mult_sugerido,
     resultado_atual, resultado_sugerido, ganho_estimado, pregoes,
     dias_afetados, peso_top3, confiavel, motivo)
  SELECT v_semana, m.symbol, m.variant, m.mode, ap.apelido,
         a.mult_atual, m.n,
         round(a.res_atual, 2), round(m.resultado, 2),
         round(m.resultado - a.res_atual, 2),
         m.pregoes, m.dias_afetados, m.peso_top3,
         (m.resultado - a.res_atual > 0
          AND m.dias_afetados >= 5
          AND coalesce(m.peso_top3, 1) <= 0.60),
         CASE
           WHEN m.resultado - a.res_atual <= 0 THEN 'mudanca nao melhora'
           WHEN m.dias_afetados < 5 THEN 'poucos dias afetados (' || m.dias_afetados || ') — amostra fraca'
           WHEN coalesce(m.peso_top3,1) > 0.60 THEN 'efeito concentrado em 3 dias (' ||
                round(coalesce(m.peso_top3,1)*100) || '%) — pode ser sorte'
           ELSE 'sugestao com amostra e distribuicao aceitaveis'
         END
  FROM melhor m
  JOIN atual a USING (symbol, variant, mode)
  LEFT JOIN b3_mode_apelidos ap ON ap.mode = m.mode
  WHERE m.n <> a.mult_atual
  ON CONFLICT (semana_ref, symbol, variant, mode) DO NOTHING;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  -- Registro dos robos pulados por multiplicador real indeterminado.
  SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'variant', variant, 'mode', mode, 'mults_vistos', vistos))
    INTO v_pulados
  FROM (SELECT r.symbol, r.variant, s.mode, array_agg(DISTINCT s.daily_stop_mult) AS vistos
        FROM b3_simulation_orders o
        JOIN b3_simulation_runs r ON r.id = o.simulation_run_id
        JOIN b3_simulation_mode_settings s ON s.simulation_run_id = r.id AND s.mode = o.mode
        WHERE o.status = 'closed' AND o.exit_time >= v_fim - (p_dias || ' days')::interval AND o.exit_time < v_fim
        GROUP BY 1,2,3
        HAVING count(DISTINCT s.daily_stop_mult) > 1 OR bool_or(s.daily_stop_mult IS NULL)) z;
  IF v_pulados IS NOT NULL THEN
    INSERT INTO system_logs (event_type, source, severity, message, technical_data)
    VALUES ('calibracao_robo_pulado', 'b3_calibrar_limites', 'warning',
            'Calibração ' || v_semana || ': ' || jsonb_array_length(v_pulados) ||
            ' robô(s) pulado(s) — multiplicador real indeterminado (execuções com valores diferentes)',
            jsonb_build_object('semana_ref', v_semana, 'pulados', v_pulados));
  END IF;
  RETURN v_linhas;
END;
$function$;