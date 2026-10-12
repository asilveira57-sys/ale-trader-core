CREATE OR REPLACE FUNCTION public.b3_export_csv_decisoes(p_date date)
 RETURNS TABLE(linhas bigint, csv text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET statement_timeout TO '180s'
AS $function$
  WITH agg AS (
    SELECT public.b3_export_raiz(l.symbol) AS ativo, l.entry_style, l.mode, l.estagio,
           left(l.motivo, 120) AS motivo, count(*) AS vezes,
           avg(l.score) AS score_medio, avg(l.approve_votes) AS votos_medios,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY l.score) AS s10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY l.score) AS s25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY l.score) AS s50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY l.score) AS s75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY l.score) AS s90,
           avg(l.confidence) AS conf_media,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY l.confidence) AS c10,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY l.confidence) AS c25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY l.confidence) AS c50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY l.confidence) AS c75,
           percentile_cont(0.90) WITHIN GROUP (ORDER BY l.confidence) AS c90
      FROM public.b3_entry_decision_log l
     WHERE l.trade_date = p_date
     GROUP BY 1, 2, 3, 4, 5
  )
  SELECT (SELECT count(*) FROM agg),
         'data,ativo,modalidade,modo,estagio,motivo,vezes,score_medio,votos_medios,score_p10,score_p25,score_p50,score_p75,score_p90,confianca_media,confianca_p10,confianca_p25,confianca_p50,confianca_p75,confianca_p90'
         || coalesce(E'\n' || (
              SELECT string_agg(
                p_date::text || ',' || public.b3_csv_txt(ativo) || ',' || public.b3_csv_txt(entry_style) || ','
                || public.b3_csv_txt(mode) || ',' || public.b3_csv_txt(estagio) || ',' || public.b3_csv_txt(motivo) || ','
                || vezes::text || ',' || public.b3_csv_num(score_medio) || ',' || public.b3_csv_num(votos_medios)
                || ',' || public.b3_csv_num(s10::numeric) || ',' || public.b3_csv_num(s25::numeric) || ',' || public.b3_csv_num(s50::numeric)
                || ',' || public.b3_csv_num(s75::numeric) || ',' || public.b3_csv_num(s90::numeric)
                || ',' || public.b3_csv_num(conf_media) || ',' || public.b3_csv_num(c10::numeric) || ',' || public.b3_csv_num(c25::numeric)
                || ',' || public.b3_csv_num(c50::numeric) || ',' || public.b3_csv_num(c75::numeric) || ',' || public.b3_csv_num(c90::numeric),
                E'\n' ORDER BY ativo, entry_style, mode, estagio, motivo)
              FROM agg), '')
         || E'\n'
$function$;