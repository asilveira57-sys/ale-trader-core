
-- EXPORTAÇÃO NOTURNA (22/09/2026) — parte 2: agendamento.
-- A retenção sai do fim da curadoria (17:35) e ganha horário próprio às 19:00,
-- DEPOIS da exportação. Assim a retenção nunca apaga um dia sem cópia.

-- 1) Fecha as funções novas: só o próprio sistema chama.
REVOKE ALL ON FUNCTION public.b3_export_dias(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b3_export_csv_bloqueios(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b3_export_csv_dossie_ordens(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b3_export_csv_dossie_votos(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b3_export_csv_decisoes(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b3_export_dias(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.b3_export_csv_bloqueios(date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.b3_export_csv_dossie_ordens(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.b3_export_csv_dossie_votos(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.b3_export_csv_decisoes(date) TO service_role;

-- 2) Gatilho da exportação. Mesma forma dos outros disparos do sistema.
CREATE OR REPLACE FUNCTION public.b3_disparar_exportacao()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req bigint;
BEGIN
  SELECT net.http_post(
    url     := 'https://project--d7946518-67dd-4c85-bfb5-fad9472b09e3.lovable.app/api/public/hooks/b3-exportacao-noturna',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_Hz7Y-i9-xK2mLiwDRJmbOg_KXiLKh5C"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_req;
  RETURN 'disparado req=' || v_req;
END;
$function$;

REVOKE ALL ON FUNCTION public.b3_disparar_exportacao() FROM PUBLIC, anon, authenticated;

-- 3) Curadoria SEM a retenção no fim. O resto fica idêntico, na mesma ordem.
SELECT cron.schedule(
  'b3-curadoria-diaria',
  '35 20 * * 1-5',
  $cron$
SELECT public.b3_materializar_m1();
SELECT public.b3_calcular_score_dia();
SELECT public.b3_avaliar_saude_pregao();
SELECT public.b3_marcar_dias_com_intervencao((now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT public.b3_atualizar_curadoria();
SELECT public.b3_rotular_regime((now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT public.b3_diagnosticar_dia((now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT public.b3_calcular_paridade();
-- RETENCAO SAIU DAQUI EM 22/09/2026: virou o job b3-retencao-diaria, as 19:00
-- (22:00 UTC), depois da exportacao noturna. Nenhum dia e apagado sem copia.
$cron$
);

-- 4) Exportação noturna: 18:30 às 18:50 BRT (21:30-21:50 UTC), dias úteis.
--    Cada passada grava só o que ainda falta; repetir e inofensivo.
SELECT cron.schedule('b3-exportacao-noturna', '30,35,40,45,50 21 * * 1-5',
  $cron$ SELECT public.b3_disparar_exportacao(); $cron$);

-- 5) Retenção com horário próprio, 19:00 BRT (22:00 UTC), dias úteis.
--    Teto igual ao que estava no fim da curadoria.
SELECT cron.schedule('b3-retencao-diaria', '0 22 * * 1-5',
  $cron$ SELECT public.b3_retencao_diaria(20000, 200); $cron$);
