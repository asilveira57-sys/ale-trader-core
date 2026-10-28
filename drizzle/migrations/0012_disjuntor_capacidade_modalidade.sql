CREATE OR REPLACE FUNCTION public.b3_disjuntor_capacidade(p_user_id uuid, p_symbols text[] DEFAULT ARRAY['WIN']::text[], p_variants text[] DEFAULT NULL::text[])
RETURNS TABLE(symbol text, variant text, mode text, max_contracts integer, margin_per_contract_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
 SELECT public.b3_carteira_raiz(r.symbol), coalesce(r.variant,'indicador'), s.mode::text, s.max_contracts::integer, a.margin_per_contract_brl::numeric
 FROM public.b3_simulation_mode_settings s
 JOIN public.b3_simulation_runs r ON r.id=s.simulation_run_id
 LEFT JOIN LATERAL (
   SELECT ap.margin_per_contract_brl FROM public.b3_asset_profiles ap
   WHERE public.b3_carteira_raiz(ap.symbol)=public.b3_carteira_raiz(r.symbol)
   ORDER BY (ap.symbol=r.symbol) DESC, ap.symbol DESC LIMIT 1
 ) a ON true
 WHERE r.user_id=p_user_id AND s.user_id=p_user_id AND r.status='running' AND coalesce(s.enabled,true)
 AND (p_symbols IS NULL OR public.b3_carteira_raiz(r.symbol)=ANY(p_symbols))
 AND (p_variants IS NULL OR coalesce(r.variant,'indicador')=ANY(p_variants));
$$;
REVOKE ALL ON FUNCTION public.b3_disjuntor_capacidade(uuid,text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.b3_disjuntor_capacidade(uuid,text[],text[]) TO authenticated, service_role;
DO $migration$
DECLARE original text; replacement text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT original FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='b3_disjuntor_simulado';
 replacement := regexp_replace(original, '  base as \([\s\S]*?\n  acumulada as \(', E'  base as (\n    select coalesce(p_capital_base,\n      (select sum(c.max_contracts * c.margin_per_contract_brl)\n       from public.b3_disjuntor_capacidade(p_user_id,p_symbols,p_variants) c), 0) valor,\n      case when p_capital_base is not null then ''informado''\n           else ''capacidade dos robôs habilitados'' end origem\n  ),\n  acumulada as (');
 IF replacement=original THEN RAISE EXCEPTION 'Bloco da base não encontrado; nenhuma mudança aplicada'; END IF;
 replacement := replace(replacement, E'  -- O capital base, quando nulo, tambem respeita o cenario: com freio usa o pico\n  -- de capital exposto das ordens nao barradas.', E'  -- Capital automático = capacidade dos robôs habilitados em runs running.\n  -- Margem vem exclusivamente de b3_asset_profiles, sem reserva adicional.');
 EXECUTE replacement;
END $migration$;