
-- EXPORTAÇÃO NOTURNA (22/09/2026) — parte 1: montagem dos CSV dentro do banco.
-- Só leitura. Nada aqui apaga, altera motor, freio, limite ou espelho real.
-- O conteúdo é montado no banco de propósito: o endpoint só recebe o texto
-- pronto e grava no arquivo, sem trazer linha por linha para a aplicação.

-- Vírgula é o separador do arquivo, então vírgula dentro de texto vira espaço.
CREATE OR REPLACE FUNCTION public.b3_csv_txt(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(regexp_replace(replace(replace(t, ',', ' '), '"', ' '), '[\r\n\t]+', ' ', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.b3_csv_num(v numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL THEN '' ELSE trim(to_char(round(v, 2), 'FM9999999999990.00')) END
$$;

-- WINV26 -> WIN. Ações e nomes sem vencimento ficam como estão.
CREATE OR REPLACE FUNCTION public.b3_export_raiz(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '^[A-Z]{3}[FGHJKMNQUVXZ][0-9]{2}$' THEN left(p, 3) ELSE coalesce(p, '') END
$$;

-- Dias que ainda existem no banco, com os ativos de cada um.
CREATE OR REPLACE FUNCTION public.b3_export_dias(p_desde date DEFAULT NULL)
RETURNS TABLE(dia date, ativos text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lim AS (SELECT coalesce(p_desde, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 12)) AS d0),
  fonte AS (
    SELECT (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           public.b3_export_raiz(r.symbol) AS ativo
      FROM public.b3_simulation_block_events e
      JOIN public.b3_simulation_runs r ON r.id = e.simulation_run_id
     WHERE e.occurred_at >= (SELECT d0 FROM lim)
    UNION
    SELECT (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date, public.b3_export_raiz(o.symbol)
      FROM public.b3_simulation_orders o
     WHERE o.exit_time IS NOT NULL AND o.exit_time >= (SELECT d0 FROM lim)
    UNION
    SELECT l.trade_date, public.b3_export_raiz(l.symbol)
      FROM public.b3_entry_decision_log l
     WHERE l.trade_date >= (SELECT d0 FROM lim)
  )
  SELECT dia, array_agg(DISTINCT ativo ORDER BY ativo)
    FROM fonte
   WHERE dia IS NOT NULL AND dia >= (SELECT d0 FROM lim)
   GROUP BY dia
   ORDER BY dia
$$;

-- 1. Bloqueios agregados, um arquivo por ativo. Nunca inclui diagnostic_payload.
CREATE OR REPLACE FUNCTION public.b3_export_csv_bloqueios(p_date date, p_ativo text)
RETURNS TABLE(linhas bigint, csv text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH agg AS (
    SELECT r.variant, e.mode, e."trigger" AS gatilho, e.new_status AS estado,
           count(*) AS vezes,
           to_char(min(e.occurred_at AT TIME ZONE 'America/Sao_Paulo'), 'HH24:MI') AS primeira,
           to_char(max(e.occurred_at AT TIME ZONE 'America/Sao_Paulo'), 'HH24:MI') AS ultima,
           min(e.observed_value) AS vmin, max(e.observed_value) AS vmax, max(e.limit_value) AS vlim
      FROM public.b3_simulation_block_events e
      JOIN public.b3_simulation_runs r ON r.id = e.simulation_run_id
     WHERE (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = p_date
       AND public.b3_export_raiz(r.symbol) = p_ativo
     GROUP BY 1, 2, 3, 4
  )
  SELECT (SELECT count(*) FROM agg),
         'data,ativo,modalidade,modo,gatilho,estado,vezes,primeira,ultima,valor_min,valor_max,valor_limite'
         || coalesce(E'\n' || (
              SELECT string_agg(
                p_date::text || ',' || public.b3_csv_txt(p_ativo) || ',' || public.b3_csv_txt(variant) || ','
                || public.b3_csv_txt(mode) || ',' || public.b3_csv_txt(gatilho) || ',' || public.b3_csv_txt(estado) || ','
                || vezes::text || ',' || primeira || ',' || ultima || ','
                || public.b3_csv_num(vmin) || ',' || public.b3_csv_num(vmax) || ',' || public.b3_csv_num(vlim),
                E'\n' ORDER BY variant, mode, gatilho, estado)
              FROM agg), '')
         || E'\n'
$$;

-- 2a. Dossiê: uma linha por ordem fechada no dia.
CREATE OR REPLACE FUNCTION public.b3_export_csv_dossie_ordens(p_date date)
RETURNS TABLE(linhas bigint, csv text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ord AS (
    SELECT o.id, public.b3_export_raiz(o.symbol) AS ativo, r.variant, o.mode,
           to_char(o.entry_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS') AS entrou,
           to_char(o.exit_time AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS') AS saiu,
           round(extract(epoch FROM (o.exit_time - o.entry_time)) / 60.0, 1) AS minutos,
           o.side, o.entry_price, o.exit_price, o.net_result_brl, o.entry_setup, o.entry_score,
           o.entry_confidence, o.entry_approve_votes, o.close_reason, o.stop_pts, o.gain_pts,
           o.mfe_pts, o.mae_pts, o.freios_na_sombra, o.nivel_freio_na_abertura
      FROM public.b3_simulation_orders o
      LEFT JOIN public.b3_simulation_runs r ON r.id = o.simulation_run_id
     WHERE o.exit_time IS NOT NULL
       AND (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date = p_date
  )
  SELECT (SELECT count(*) FROM ord),
         'data,ativo,modalidade,modo,order_id,entrou,saiu,minutos,lado,preco_entrada,preco_saida,resultado_brl,setup,score,confianca,votos_a_favor,motivo_saida,stop_pts,gain_pts,mfe_pts,mae_pts,freios_na_abertura,nivel_freio_na_abertura'
         || coalesce(E'\n' || (
              SELECT string_agg(
                p_date::text || ',' || public.b3_csv_txt(ativo) || ',' || public.b3_csv_txt(variant) || ','
                || public.b3_csv_txt(mode) || ',' || id::text || ',' || coalesce(entrou, '') || ',' || coalesce(saiu, '') || ','
                || public.b3_csv_num(minutos) || ',' || public.b3_csv_txt(side) || ','
                || public.b3_csv_num(entry_price) || ',' || public.b3_csv_num(exit_price) || ','
                || public.b3_csv_num(net_result_brl) || ',' || public.b3_csv_txt(entry_setup) || ','
                || public.b3_csv_num(entry_score) || ',' || public.b3_csv_num(entry_confidence) || ','
                || coalesce(entry_approve_votes::text, '') || ',' || public.b3_csv_txt(close_reason) || ','
                || public.b3_csv_num(stop_pts) || ',' || public.b3_csv_num(gain_pts) || ','
                || public.b3_csv_num(mfe_pts) || ',' || public.b3_csv_num(mae_pts) || ','
                || public.b3_csv_txt(array_to_string(freios_na_sombra, '|')) || ','
                || coalesce(nivel_freio_na_abertura::text, ''),
                E'\n' ORDER BY ativo, variant, mode, entrou)
              FROM ord), '')
         || E'\n'
$$;

-- 2b. Votos ligados às ordens do dossiê. Nunca inclui market_data_snapshot.
CREATE OR REPLACE FUNCTION public.b3_export_csv_dossie_votos(p_date date)
RETURNS TABLE(linhas bigint, csv text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (
    SELECT v.order_id, v.agent_name, v.vote, v.confidence, v.has_veto, v.reason, v.created_at
      FROM public.b3_simulation_agent_votes v
      JOIN public.b3_simulation_orders o ON o.id = v.order_id
     WHERE v.order_id IS NOT NULL
       AND o.exit_time IS NOT NULL
       AND (o.exit_time AT TIME ZONE 'America/Sao_Paulo')::date = p_date
  )
  SELECT (SELECT count(*) FROM v),
         'data,order_id,agente,voto,confianca,tem_veto,razao'
         || coalesce(E'\n' || (
              SELECT string_agg(
                p_date::text || ',' || order_id::text || ',' || public.b3_csv_txt(agent_name) || ','
                || public.b3_csv_txt(vote) || ',' || public.b3_csv_num(confidence) || ','
                || CASE WHEN has_veto IS NULL THEN '' WHEN has_veto THEN 'sim' ELSE 'nao' END || ','
                || public.b3_csv_txt(reason),
                E'\n' ORDER BY order_id, agent_name)
              FROM v), '')
         || E'\n'
$$;

-- 3. Decisões agregadas: por que cada robô não entrou.
CREATE OR REPLACE FUNCTION public.b3_export_csv_decisoes(p_date date)
RETURNS TABLE(linhas bigint, csv text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH agg AS (
    SELECT public.b3_export_raiz(l.symbol) AS ativo, l.entry_style, l.mode, l.estagio,
           left(l.motivo, 120) AS motivo, count(*) AS vezes,
           avg(l.score) AS score_medio, avg(l.approve_votes) AS votos_medios
      FROM public.b3_entry_decision_log l
     WHERE l.trade_date = p_date
     GROUP BY 1, 2, 3, 4, 5
  )
  SELECT (SELECT count(*) FROM agg),
         'data,ativo,modalidade,modo,estagio,motivo,vezes,score_medio,votos_medios'
         || coalesce(E'\n' || (
              SELECT string_agg(
                p_date::text || ',' || public.b3_csv_txt(ativo) || ',' || public.b3_csv_txt(entry_style) || ','
                || public.b3_csv_txt(mode) || ',' || public.b3_csv_txt(estagio) || ',' || public.b3_csv_txt(motivo) || ','
                || vezes::text || ',' || public.b3_csv_num(score_medio) || ',' || public.b3_csv_num(votos_medios),
                E'\n' ORDER BY ativo, entry_style, mode, estagio, motivo)
              FROM agg), '')
         || E'\n'
$$;

REVOKE ALL ON FUNCTION public.b3_export_dias(date) FROM anon;
REVOKE ALL ON FUNCTION public.b3_export_csv_bloqueios(date, text) FROM anon;
REVOKE ALL ON FUNCTION public.b3_export_csv_dossie_ordens(date) FROM anon;
REVOKE ALL ON FUNCTION public.b3_export_csv_dossie_votos(date) FROM anon;
REVOKE ALL ON FUNCTION public.b3_export_csv_decisoes(date) FROM anon;

-- O dono do projeto pode baixar o que foi arquivado.
DROP POLICY IF EXISTS "dono le arquivo b3" ON storage.objects;
CREATE POLICY "dono le arquivo b3" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'b3-arquivo' AND public.is_owner());
