CREATE OR REPLACE FUNCTION public.b3_magic(p_symbol text, p_variant text, p_mode text)
RETURNS integer LANGUAGE sql STABLE AS $function$
-- magic = ativo*1000 + modalidade*100 + modo.
-- WIN=2, indicador=0 e price_action=5 sao INTOCAVEIS: preservam 2001 e 2504 reais.
-- Antes de 30/08: 410 colisoes e 54 robos com magic 0. WDO=1 evita o bloco WIN.
-- Raiz pelo perfil preserva a identidade na rolagem de contrato.
SELECT 1000 * CASE upper(coalesce((SELECT ap.quote_symbol FROM public.b3_asset_profiles ap WHERE ap.symbol=p_symbol OR ap.quote_symbol=upper(p_symbol) LIMIT 1),p_symbol))
WHEN 'WDO' THEN 1 WHEN 'WIN' THEN 2 WHEN 'PETR4' THEN 3 WHEN 'VALE3' THEN 4 WHEN 'ITUB4' THEN 5 WHEN 'BBDC4' THEN 6 WHEN 'BBAS3' THEN 7 WHEN 'BIT' THEN 8 WHEN 'ETR' THEN 9 WHEN 'SOL' THEN 10 WHEN 'WEU' THEN 11 WHEN 'PRIO3' THEN 12 WHEN 'GLD' THEN 13 ELSE 0 END
+ 100 * CASE lower(coalesce(p_variant,'')) WHEN 'indicador' THEN 0 WHEN 'mean_reversion' THEN 1 WHEN 'range' THEN 2 WHEN 'rompimento' THEN 3 WHEN 'pullback' THEN 4 WHEN 'price_action' THEN 5 WHEN 'vwap' THEN 6 WHEN 'price_action_sc' THEN 7 ELSE -1 END
+ CASE lower(coalesce(p_mode,'')) WHEN 'conservador' THEN 1 WHEN 'conservador_sc' THEN 1 WHEN 'moderado' THEN 2 WHEN 'moderado_sc' THEN 2 WHEN 'equilibrado' THEN 3 WHEN 'equilibrado_sc' THEN 3 WHEN 'semi_agressivo' THEN 4 WHEN 'semi_agressivo_sc' THEN 4 WHEN 'agressivo' THEN 5 WHEN 'agressivo_sc' THEN 5 WHEN 'cauteloso' THEN 6 WHEN 'cauteloso_sc' THEN 6 WHEN 'arrojado' THEN 7 WHEN 'arrojado_sc' THEN 7 WHEN 'enoir' THEN 8 WHEN 'enoir_sc' THEN 8 ELSE 0 END;
$function$;
ALTER TABLE public.b3_prd_authorizations DROP CONSTRAINT b3_prd_auth_modo_valido;
ALTER TABLE public.b3_prd_authorizations ADD CONSTRAINT b3_prd_auth_modo_valido CHECK(mode = ANY(ARRAY['conservador','cauteloso','moderado','equilibrado','semi_agressivo','arrojado','agressivo','enoir','conservador_sc','cauteloso_sc','moderado_sc','equilibrado_sc','semi_agressivo_sc','arrojado_sc','agressivo_sc','enoir_sc']));
CREATE OR REPLACE FUNCTION public.b3_prd_tela_insumos()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $function$
SELECT coalesce(jsonb_agg(jsonb_build_object('symbol',a.symbol,'variant',a.variant,'mode',a.mode,'stop_pts',c.stop_pts,'point_value_brl',c.tick_value_brl,'sim_max_contracts',c.max_contracts,'simulado_ativo',EXISTS(SELECT 1 FROM public.b3_simulation_runs r JOIN public.b3_asset_profiles ap ON ap.active AND ap.symbol=r.symbol AND (ap.symbol=a.symbol OR left(ap.symbol,greatest(length(ap.symbol)-3,1))=a.symbol) JOIN public.b3_simulation_mode_settings s ON s.simulation_run_id=r.id WHERE r.user_id=a.user_id AND r.variant=a.variant AND r.status='running' AND s.enabled=true))),'[]'::jsonb)
FROM public.b3_prd_authorizations a
LEFT JOIN LATERAL (
-- Identical stop lookup to b3_prd_preencher_limite_diario; do not restrict to running.
SELECT s.stop_pts, ap.tick_value_brl, s.max_contracts
FROM public.b3_simulation_runs r
JOIN public.b3_asset_profiles ap ON ap.active AND ap.symbol=r.symbol
 AND (ap.symbol=a.symbol OR left(ap.symbol,greatest(length(ap.symbol)-3,1))=a.symbol)
JOIN public.b3_simulation_mode_settings s ON s.simulation_run_id=r.id AND s.mode=a.mode
WHERE r.variant=a.variant AND s.stop_pts IS NOT NULL AND s.stop_pts>0
ORDER BY (r.status='running') DESC LIMIT 1
) c ON true
WHERE a.user_id=auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.b3_prd_tela_insumos() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_prd_tela_insumos() TO authenticated,service_role;