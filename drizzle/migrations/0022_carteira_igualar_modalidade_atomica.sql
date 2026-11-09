-- Preserve the current audited transfer body and delegate to a private core.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.b3_carteira_transferir(uuid,text,text,text,text,numeric,text,boolean,jsonb)'::regprocedure) INTO definition;
 definition := replace(definition,'public.b3_carteira_transferir(', 'public.b3_carteira_transferir_interno(');
 definition := replace(definition,'p_snapshot jsonb DEFAULT NULL::jsonb)', 'p_snapshot jsonb DEFAULT NULL::jsonb, p_igualar boolean DEFAULT false)');
 definition := replace(definition,'IF p_valor>maximo THEN', 'IF NOT p_igualar AND p_valor>maximo THEN');
 definition := replace(definition,'IF de_ctr<1 THEN', 'IF NOT p_igualar AND de_ctr<1 THEN');
 IF position('p_igualar boolean' in definition)=0 OR position('NOT p_igualar AND p_valor>maximo' in definition)=0 OR position('NOT p_igualar AND de_ctr<1' in definition)=0 THEN RAISE EXCEPTION 'Transfer signature changed; migration cancelled'; END IF;
 EXECUTE definition;
END $migration$;
REVOKE ALL ON FUNCTION public.b3_carteira_transferir_interno(uuid,text,text,text,text,numeric,text,boolean,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.b3_carteira_transferir(p_user_id uuid,p_symbol text,p_variant text,p_de_mode text DEFAULT NULL,p_para_mode text DEFAULT NULL,p_valor numeric DEFAULT NULL,p_motivo text DEFAULT NULL,p_previa boolean DEFAULT false,p_snapshot jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $fn$
BEGIN
 RETURN b3_carteira_transferir_interno(p_user_id,p_symbol,p_variant,p_de_mode,p_para_mode,p_valor,p_motivo,p_previa,p_snapshot,false);
END $fn$;
REVOKE ALL ON FUNCTION public.b3_carteira_transferir(uuid,text,text,text,text,numeric,text,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_carteira_transferir(uuid,text,text,text,text,numeric,text,boolean,jsonb) TO authenticated,service_role;

-- Pure read-only plan. SQL alone owns capacity, targets, cent remainder and totals.
CREATE OR REPLACE FUNCTION public.b3_carteira_igualar_plano(p_symbol text,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public AS $fn$
DECLARE total numeric; n int; base numeric; restante numeric; linhas jsonb; antes int; depois int;
BEGIN
 IF p_rows IS NULL OR jsonb_array_length(p_rows)<>8 THEN RETURN jsonb_build_object('ok',false,'error','A modalidade precisa ter exatamente oito carteiras'); END IF;
 SELECT sum((r->>'saldo')::numeric),sum((r->>'contratos')::int) INTO total,antes FROM jsonb_array_elements(p_rows) r;
 n := b3_carteira_contratos(p_symbol,total,8);
 IF n<1 THEN RETURN jsonb_build_object('ok',false,'error','não há saldo para um contrato sequer — nada a igualar'); END IF;
 base := trunc(total/n,2); restante := total-base*n;
 WITH ranked AS (
 SELECT r,row_number() OVER(ORDER BY (r->>'saldo')::numeric DESC,r->>'mode') AS pos FROM jsonb_array_elements(p_rows) r
 ), targets AS (
 SELECT r,CASE WHEN pos<=n THEN base+CASE WHEN pos=1 THEN restante ELSE 0 END ELSE 0 END AS saldo FROM ranked
 ), computed AS (
 SELECT r,saldo,b3_carteira_contratos(p_symbol,saldo,(r->>'teto')::int) AS ctr FROM targets
 ) SELECT jsonb_agg(r||jsonb_build_object('saldo_depois',saldo,'contratos_depois',ctr,'transferencias_depois',(r->>'transferencias_liquidas')::numeric+saldo-(r->>'saldo')::numeric) ORDER BY r->>'mode'),sum(ctr) INTO linhas,depois FROM computed;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(linhas) r WHERE (r->>'saldo_depois')::numeric>0 AND (r->>'contratos_depois')::int<1) THEN RETURN jsonb_build_object('ok',false,'error','Teto de robô impede um contrato. Confira os limites antes de igualar.'); END IF;
 RETURN jsonb_build_object('ok',true,'symbol',p_symbol,'n',n,'rows',linhas,'capital_antes',total,'capital_depois',total,'contratos_antes',antes,'contratos_depois',depois,'reduz_contratos',depois<antes);
END $fn$;
REVOKE ALL ON FUNCTION public.b3_carteira_igualar_plano(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_carteira_igualar_plano(text,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.b3_carteira_igualar(p_user_id uuid,p_symbol text,p_variant text,p_previa boolean DEFAULT true,p_snapshot jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $fn$
DECLARE lista jsonb; atual jsonb; plano jsonb; leitura jsonb; margem numeric; motivo text; origem record; destino record; valor numeric; r jsonb; capital numeric;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id OR NOT public.is_owner() THEN RAISE EXCEPTION 'Apenas o dono pode igualar suas carteiras'; END IF;
 IF p_symbol IS NULL OR p_variant IS NULL THEN RAISE EXCEPTION 'Ativo e modalidade obrigatórios'; END IF;
 IF NOT p_previa THEN
 PERFORM id FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant ORDER BY id FOR UPDATE;
 -- Lock ceilings and margin too: a confirmed plan must not race configuration edits.
 PERFORM s.id FROM b3_simulation_mode_settings s JOIN b3_simulation_runs run ON run.id=s.simulation_run_id WHERE s.user_id=p_user_id AND b3_carteira_raiz(run.symbol)=p_symbol AND coalesce(run.variant,'indicador')=p_variant ORDER BY s.id FOR SHARE OF s;
 PERFORM symbol FROM b3_asset_profiles WHERE b3_carteira_raiz(symbol)=p_symbol ORDER BY symbol FOR SHARE;
 END IF;
 leitura := b3_carteira_transferir(p_user_id,p_symbol,p_variant,p_previa=>true);
 IF NOT coalesce((leitura->>'ok')::boolean,false) THEN RETURN leitura; END IF;
 SELECT max(margin_per_contract_brl) INTO margem FROM b3_asset_profiles WHERE b3_carteira_raiz(symbol)=p_symbol AND margin_per_contract_brl>0;
 SELECT jsonb_agg(row||jsonb_build_object('teto',coalesce((SELECT s.max_contracts FROM b3_simulation_mode_settings s JOIN b3_simulation_runs run ON run.id=s.simulation_run_id WHERE s.user_id=p_user_id AND b3_carteira_raiz(run.symbol)=p_symbol AND coalesce(run.variant,'indicador')=p_variant AND s.mode=row->>'mode' ORDER BY (run.status='running') DESC,run.started_at DESC,s.id LIMIT 1),1)) ORDER BY row->>'mode') INTO lista FROM jsonb_array_elements(leitura->'rows') row;
 atual := jsonb_build_object('rows',lista,'margem',margem);
 plano := b3_carteira_igualar_plano(p_symbol,lista);
 IF NOT coalesce((plano->>'ok')::boolean,false) THEN RETURN plano; END IF;
 motivo := 'igualar modalidade '||to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD');
 plano := plano||jsonb_build_object('variant',p_variant,'snapshot',atual,'motivo',motivo);
 IF p_previa THEN RETURN plano; END IF;
 IF p_snapshot IS NULL OR p_snapshot IS DISTINCT FROM atual THEN RETURN jsonb_build_object('ok',false,'error','Os saldos ou limites mudaram. Confira uma nova prévia antes de confirmar.'); END IF;
 IF EXISTS(SELECT 1 FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant AND saldo_inicial_brl+resultado_proprio_brl+recebido_de_transferencias_brl<>saldo_atual_brl) THEN RAISE EXCEPTION 'Invariante divergente; equalização cancelada'; END IF;
 -- Donors are drained only toward final deficits. Every pair uses the same audited transfer core.
 FOR origem IN SELECT c.mode,c.saldo_atual_brl-(x->>'saldo_depois')::numeric AS sobra FROM b3_carteira_robo c JOIN jsonb_array_elements(plano->'rows') x ON x->>'mode'=c.mode WHERE c.user_id=p_user_id AND c.symbol=p_symbol AND c.variant=p_variant AND c.saldo_atual_brl>(x->>'saldo_depois')::numeric ORDER BY c.mode LOOP
 FOR destino IN SELECT c.mode,(x->>'saldo_depois')::numeric-c.saldo_atual_brl AS falta FROM b3_carteira_robo c JOIN jsonb_array_elements(plano->'rows') x ON x->>'mode'=c.mode WHERE c.user_id=p_user_id AND c.symbol=p_symbol AND c.variant=p_variant AND c.saldo_atual_brl<(x->>'saldo_depois')::numeric ORDER BY c.mode LOOP
 valor := least(origem.sobra,destino.falta);
 IF valor<=0 THEN CONTINUE; END IF;
 r := b3_carteira_transferir_interno(p_user_id,p_symbol,p_variant,origem.mode,destino.mode,valor,motivo,false,NULL,true);
 IF NOT coalesce((r->>'ok')::boolean,false) THEN RAISE EXCEPTION 'Equalização cancelada: %',r->>'error'; END IF;
 origem.sobra := origem.sobra-valor;
 EXIT WHEN origem.sobra=0;
 END LOOP;
 IF origem.sobra<>0 THEN RAISE EXCEPTION 'Plano divergente; equalização cancelada'; END IF;
 END LOOP;
 SELECT sum(saldo_atual_brl) INTO capital FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant;
 IF capital IS DISTINCT FROM (plano->>'capital_antes')::numeric OR EXISTS(SELECT 1 FROM b3_carteira_robo c JOIN jsonb_array_elements(plano->'rows') x ON x->>'mode'=c.mode WHERE c.user_id=p_user_id AND c.symbol=p_symbol AND c.variant=p_variant AND (c.saldo_atual_brl<>(x->>'saldo_depois')::numeric OR c.resultado_proprio_brl<>(x->>'resultado_proprio')::numeric OR c.recebido_de_transferencias_brl<>(x->>'transferencias_depois')::numeric OR c.saldo_inicial_brl+c.resultado_proprio_brl+c.recebido_de_transferencias_brl<>c.saldo_atual_brl)) THEN RAISE EXCEPTION 'Capital ou invariante divergente; equalização cancelada'; END IF;
 RETURN plano||jsonb_build_object('confirmada',true);
END $fn$;
REVOKE ALL ON FUNCTION public.b3_carteira_igualar(uuid,text,text,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_carteira_igualar(uuid,text,text,boolean,jsonb) TO authenticated,service_role;