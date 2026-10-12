CREATE TABLE public.b3_distribuicao_dia (
  trade_date date NOT NULL, symbol text NOT NULL, variant text NOT NULL, mode text NOT NULL,
  conf_n integer, conf_minimo numeric, conf_p10 numeric, conf_p25 numeric, conf_p50 numeric, conf_p75 numeric, conf_p90 numeric, conf_maximo numeric,
  score_n integer, score_minimo numeric, score_p10 numeric, score_p25 numeric, score_p50 numeric, score_p75 numeric, score_p90 numeric, score_maximo numeric,
  votos_n integer, votos_p50 numeric, votos_p90 numeric, votos_maximo integer,
  gravado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, symbol, variant, mode)
);
GRANT SELECT ON public.b3_distribuicao_dia TO authenticated;
GRANT ALL ON public.b3_distribuicao_dia TO service_role;
ALTER TABLE public.b3_distribuicao_dia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner le distribuicao" ON public.b3_distribuicao_dia FOR SELECT TO authenticated USING (public.is_owner());

-- Grava a distribuição (percentis) de confiança, score e votos do dia, a partir de
-- b3_entry_decision_log (estágios comite e classificador). PRECISA rodar ANTES da
-- b3_retencao_diaria (22:00): se rodar depois da poda, grava vazio em silêncio.
-- Só lê o log e escreve nesta tabela; não toca parâmetros de robô.
CREATE OR REPLACE FUNCTION public.b3_gravar_distribuicao_dia(p_date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_linhas integer; v_soma bigint; v_fonte bigint;
BEGIN
  DELETE FROM b3_distribuicao_dia WHERE trade_date = p_date;
  INSERT INTO b3_distribuicao_dia (trade_date, symbol, variant, mode,
    conf_n, conf_minimo, conf_p10, conf_p25, conf_p50, conf_p75, conf_p90, conf_maximo,
    score_n, score_minimo, score_p10, score_p25, score_p50, score_p75, score_p90, score_maximo,
    votos_n, votos_p50, votos_p90, votos_maximo)
  SELECT p_date, public.b3_raiz(symbol), entry_style, mode,
    count(*), min(confidence),
    percentile_cont(0.10) WITHIN GROUP (ORDER BY confidence), percentile_cont(0.25) WITHIN GROUP (ORDER BY confidence),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY confidence), percentile_cont(0.75) WITHIN GROUP (ORDER BY confidence),
    percentile_cont(0.90) WITHIN GROUP (ORDER BY confidence), max(confidence),
    count(*), min(score),
    percentile_cont(0.10) WITHIN GROUP (ORDER BY score), percentile_cont(0.25) WITHIN GROUP (ORDER BY score),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY score), percentile_cont(0.75) WITHIN GROUP (ORDER BY score),
    percentile_cont(0.90) WITHIN GROUP (ORDER BY score), max(score),
    count(*), percentile_cont(0.50) WITHIN GROUP (ORDER BY approve_votes),
    percentile_cont(0.90) WITHIN GROUP (ORDER BY approve_votes), max(approve_votes)
  FROM b3_entry_decision_log
  WHERE trade_date = p_date AND estagio IN ('comite','classificador')
    AND confidence IS NOT NULL AND score IS NOT NULL AND approve_votes IS NOT NULL
    AND entry_style IS NOT NULL AND mode IS NOT NULL AND symbol IS NOT NULL
  GROUP BY public.b3_raiz(symbol), entry_style, mode;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  -- Conferência que trava: n somado tem que bater com as decisões do dia.
  SELECT coalesce(sum(conf_n),0) INTO v_soma FROM b3_distribuicao_dia WHERE trade_date = p_date;
  SELECT count(*) INTO v_fonte FROM b3_entry_decision_log
   WHERE trade_date = p_date AND estagio IN ('comite','classificador')
     AND confidence IS NOT NULL AND score IS NOT NULL AND approve_votes IS NOT NULL;
  IF v_soma <> v_fonte THEN
    INSERT INTO system_logs(event_type, source, message, severity, technical_data)
    VALUES ('b3_distribuicao_divergente', 'b3_gravar_distribuicao_dia',
      format('Distribuição de %s: n somado %s ≠ %s decisões no log', p_date, v_soma, v_fonte),
      'critical', jsonb_build_object('trade_date', p_date, 'n_resumo', v_soma, 'n_log', v_fonte, 'celulas', v_linhas));
  END IF;
  RETURN v_linhas;
END $$;
REVOKE EXECUTE ON FUNCTION public.b3_gravar_distribuicao_dia(date) FROM PUBLIC, anon, authenticated;