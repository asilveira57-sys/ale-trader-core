ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS bloqueado_na_sombra boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nivel_freio_na_abertura integer;

CREATE TABLE IF NOT EXISTS public.b3_grupo_sombra_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  variant text NOT NULL,
  trade_date date NOT NULL,
  resultado_livre_brl numeric NOT NULL DEFAULT 0,
  resultado_sombra_brl numeric NOT NULL DEFAULT 0,
  ops_livre integer NOT NULL DEFAULT 0,
  ops_sombra integer NOT NULL DEFAULT 0,
  diferenca_brl numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, variant, trade_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_grupo_sombra_dia TO authenticated;
GRANT ALL ON public.b3_grupo_sombra_dia TO service_role;
ALTER TABLE public.b3_grupo_sombra_dia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuário gerencia sua própria sombra de grupo"
  ON public.b3_grupo_sombra_dia FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER b3_grupo_sombra_dia_touch BEFORE UPDATE ON public.b3_grupo_sombra_dia
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.b3_robot_daily_score
  ADD COLUMN IF NOT EXISTS net_brl_livre numeric,
  ADD COLUMN IF NOT EXISTS trades_bloqueado_sombra integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.b3_calcular_score_dia(p_date date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date date := COALESCE(p_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_min_trades constant integer := 3;
  v_folga constant numeric := 1.30;
  v_linhas integer;
BEGIN
  WITH todas AS (
    SELECT o.user_id, ap.quote_symbol AS symbol,
           COALESCE(ms.entry_style,'indicador') AS variant, o.mode,
           o.net_result_brl, o.exit_time, COALESCE(o.stop_violado,false) AS stop_violado,
           COALESCE(o.bloqueado_na_sombra,false) AS bloqueado_na_sombra,
           GREATEST(ms.stop_pts * ap.tick_value_brl * GREATEST(ms.max_contracts,1), 1) AS r_unit
    FROM b3_simulation_orders o
    JOIN b3_simulation_runs r ON r.id = o.simulation_run_id
    JOIN b3_simulation_mode_settings ms ON ms.simulation_run_id = o.simulation_run_id AND ms.mode = o.mode
    JOIN b3_asset_profiles ap ON ap.symbol = r.symbol
    WHERE o.status = 'closed' AND (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date = v_date
  ),
  -- Resultado financeiro do dia: TODAS as ordens, inclusive com stop furado
  -- e inclusive as abertas enquanto o robô estaria travado pelo freio de grupo.
  tot AS (
    SELECT user_id, symbol, variant, mode,
           SUM(net_result_brl) AS net_brl_com_violacao,
           SUM(net_result_brl) FILTER (WHERE NOT stop_violado) AS net_brl_livre,
           COUNT(*) FILTER (WHERE stop_violado) AS trades_violados,
           COUNT(*) FILTER (WHERE bloqueado_na_sombra) AS trades_sombra
    FROM todas GROUP BY 1,2,3,4
  ),
  -- Metricas de QUALIDADE (medalha, sequência, score): resultado SOMBRA.
  -- Fora as ordens com stop furado (medem infraestrutura) e fora as ordens
  -- abertas enquanto o freio de grupo travaria o robô — no dinheiro real elas
  -- não existiriam, e premiar recuperação que o real não captura produz
  -- ranking que não descreve o sistema.
  ord AS (SELECT * FROM todas WHERE NOT stop_violado AND NOT bloqueado_na_sombra),
  curva AS (SELECT *, SUM(net_result_brl) OVER (PARTITION BY user_id, symbol, variant, mode ORDER BY exit_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum FROM ord),
  dd AS (SELECT user_id, symbol, variant, mode, MAX(GREATEST(pico - acum, 0)) AS max_dd
    FROM (SELECT *, MAX(acum) OVER (PARTITION BY user_id, symbol, variant, mode ORDER BY exit_time
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS pico FROM curva) x GROUP BY 1,2,3,4),
  pos AS (
    SELECT o.user_id, ap.quote_symbol AS symbol,
           COALESCE(ms.entry_style,'indicador') AS variant, o.mode,
           o.entry_time AS t_in, COALESCE(o.exit_time, now()) AS t_out, o.quantity,
           CASE ap.margin_model
             WHEN 'per_contract' THEN ap.margin_per_contract_brl * o.quantity
             ELSE o.entry_price * o.quantity * ap.margin_percent_position / 100 END AS margem
    FROM b3_simulation_orders o
    JOIN b3_simulation_runs r ON r.id = o.simulation_run_id
    JOIN b3_simulation_mode_settings ms ON ms.simulation_run_id = o.simulation_run_id AND ms.mode = o.mode
    JOIN b3_asset_profiles ap ON ap.symbol = r.symbol
    WHERE o.status IN ('open','closed')
      AND (o.entry_time AT TIME ZONE 'America/Sao_Paulo')::date = v_date
  ),
  ev AS (
    SELECT user_id, symbol, variant, mode, t_in AS t,  margem AS dm,  quantity AS dq FROM pos
    UNION ALL
    SELECT user_id, symbol, variant, mode, t_out,     -margem,      -quantity      FROM pos
  ),
  accm AS (
    SELECT user_id, symbol, variant, mode, t,
      SUM(dm) OVER (PARTITION BY user_id,symbol,variant,mode ORDER BY t, dm DESC ROWS UNBOUNDED PRECEDING) AS aberta,
      SUM(dq) OVER (PARTITION BY user_id,symbol,variant,mode ORDER BY t, dm DESC ROWS UNBOUNDED PRECEDING) AS qtd
    FROM ev
  ),
  pico AS (
    SELECT user_id, symbol, variant, mode,
           ROUND(MAX(aberta) * v_folga, 2) AS pico_margem,
           MAX(qtd)::integer AS pico_contratos,
           ((ARRAY_AGG(t ORDER BY aberta DESC, t))[1] AT TIME ZONE 'America/Sao_Paulo')::time AS pico_hora
    FROM accm GROUP BY 1,2,3,4
  ),
  agg AS (SELECT c.user_id, c.symbol, c.variant, c.mode, SUM(c.net_result_brl) AS net_brl,
           COUNT(*) AS trades, COUNT(*) FILTER (WHERE c.net_result_brl > 0) AS wins,
           MIN(c.r_unit) AS r_unit, COALESCE(MAX(d.max_dd),0) AS max_dd
    FROM curva c LEFT JOIN dd d USING (user_id, symbol, variant, mode) GROUP BY 1,2,3,4),
  calc AS (SELECT a.*, ROUND(a.wins::numeric / NULLIF(a.trades,0) * 100, 2) AS win_rate,
           LEAST(100, GREATEST(0, 50 + 25 * a.net_brl / a.r_unit)) AS s_net,
           LEAST(100, GREATEST(0, a.wins::numeric / NULLIF(a.trades,0) * 100)) AS s_wr,
           LEAST(100, GREATEST(0, 100 * (1 - a.max_dd / (2 * a.r_unit)))) AS s_dd FROM agg a),
  final AS (SELECT c.*, ROUND(0.50*c.s_net + 0.25*c.s_wr + 0.25*c.s_dd, 2) AS score,
           RANK() OVER (PARTITION BY c.user_id, c.symbol ORDER BY (0.50*c.s_net + 0.25*c.s_wr + 0.25*c.s_dd) DESC) AS rank_day
    FROM calc c)
  INSERT INTO b3_robot_daily_score
    (user_id, trade_date, symbol, variant, mode, net_brl, trades, wins, win_rate,
     max_dd_brl, r_unit_brl, s_net, s_wr, s_dd, score, rank_day, qualified,
     pico_margem_brl, pico_contratos, pico_hora,
     net_brl_com_violacao, trades_stop_violado, net_brl_livre, trades_bloqueado_sombra)
  SELECT f.user_id, v_date, f.symbol, f.variant, f.mode, f.net_brl, f.trades, f.wins, f.win_rate,
         f.max_dd, f.r_unit, ROUND(f.s_net,2), ROUND(f.s_wr,2), ROUND(f.s_dd,2), f.score, f.rank_day,
         (f.trades >= v_min_trades AND f.net_brl > 0 AND f.score >= 60 AND f.rank_day <= 5),
         p.pico_margem, p.pico_contratos, p.pico_hora,
         COALESCE(t.net_brl_com_violacao, f.net_brl), COALESCE(t.trades_violados, 0),
         COALESCE(t.net_brl_livre, f.net_brl), COALESCE(t.trades_sombra, 0)
  FROM final f
  LEFT JOIN pico p USING (user_id, symbol, variant, mode)
  LEFT JOIN tot  t USING (user_id, symbol, variant, mode)
  ON CONFLICT (user_id, trade_date, symbol, variant, mode) DO UPDATE SET
    net_brl=EXCLUDED.net_brl, trades=EXCLUDED.trades, wins=EXCLUDED.wins,
    win_rate=EXCLUDED.win_rate, max_dd_brl=EXCLUDED.max_dd_brl, r_unit_brl=EXCLUDED.r_unit_brl,
    s_net=EXCLUDED.s_net, s_wr=EXCLUDED.s_wr, s_dd=EXCLUDED.s_dd, score=EXCLUDED.score,
    rank_day=EXCLUDED.rank_day, qualified=EXCLUDED.qualified,
    pico_margem_brl=EXCLUDED.pico_margem_brl, pico_contratos=EXCLUDED.pico_contratos,
    pico_hora=EXCLUDED.pico_hora,
    net_brl_com_violacao=EXCLUDED.net_brl_com_violacao,
    trades_stop_violado=EXCLUDED.trades_stop_violado,
    net_brl_livre=EXCLUDED.net_brl_livre,
    trades_bloqueado_sombra=EXCLUDED.trades_bloqueado_sombra;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RETURN v_linhas;
END;
$function$;