CREATE TABLE public.b3_carteira_transferencia (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 symbol text NOT NULL, variant text NOT NULL, de_mode text NOT NULL, para_mode text NOT NULL,
 valor_brl numeric NOT NULL CHECK(valor_brl > 0), motivo text NOT NULL CHECK(length(btrim(motivo)) > 0),
 de_saldo_antes numeric NOT NULL, de_saldo_depois numeric NOT NULL,
 para_saldo_antes numeric NOT NULL, para_saldo_depois numeric NOT NULL,
 de_contratos_antes integer NOT NULL, de_contratos_depois integer NOT NULL,
 para_contratos_antes integer NOT NULL, para_contratos_depois integer NOT NULL,
 criada_em timestamptz DEFAULT now(), criada_por text NOT NULL,
 CHECK(de_mode <> para_mode)
);
GRANT SELECT ON public.b3_carteira_transferencia TO authenticated;
GRANT ALL ON public.b3_carteira_transferencia TO service_role;
ALTER TABLE public.b3_carteira_transferencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dono le suas transferencias" ON public.b3_carteira_transferencia FOR SELECT TO authenticated USING(auth.uid() = user_id AND public.is_owner());
CREATE INDEX b3_carteira_transferencia_usuario_data ON public.b3_carteira_transferencia(user_id,criada_em DESC);

CREATE OR REPLACE FUNCTION public.b3_carteira_aplicar(p_id uuid, p_delta numeric, p_max integer, p_origem text, p_tipo text DEFAULT 'resultado') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $fn$
DECLARE c b3_carteira_robo; novo_saldo numeric; novos int; novo_estado text;
BEGIN
 IF p_tipo IS NULL OR p_tipo NOT IN ('resultado','transferencia') THEN RAISE EXCEPTION 'Tipo de movimento de carteira inválido'; END IF;
 SELECT * INTO c FROM b3_carteira_robo WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 novo_saldo := c.saldo_atual_brl + coalesce(p_delta,0);
 novos := b3_carteira_contratos(c.symbol,novo_saldo,p_max);
 novo_estado := CASE WHEN novos >= 1 THEN 'ativa' ELSE 'carteira_insuficiente' END;
 IF coalesce(p_delta,0)=0 AND novos=c.contratos_atuais AND novo_estado=c.estado THEN RETURN; END IF;
 UPDATE b3_carteira_robo SET saldo_atual_brl=novo_saldo,
 resultado_proprio_brl=resultado_proprio_brl+CASE WHEN p_tipo='resultado' THEN coalesce(p_delta,0) ELSE 0 END,
 recebido_de_transferencias_brl=recebido_de_transferencias_brl+CASE WHEN p_tipo='transferencia' THEN coalesce(p_delta,0) ELSE 0 END,
 contratos_atuais=novos, estado=novo_estado, atualizada_em=now() WHERE id=p_id;
 IF novo_estado <> c.estado THEN
 INSERT INTO system_logs(event_type,source,message,severity,technical_data) VALUES (
 CASE WHEN novo_estado='carteira_insuficiente' THEN 'carteira_robo_insuficiente' ELSE 'carteira_robo_recuperada' END,
 'b3_carteira_robo',
 format('%s %s (%s): %s — saldo R$ %s, %s contrato(s)',c.symbol,c.variant,c.mode,
 CASE WHEN novo_estado='carteira_insuficiente' THEN 'entrou em carteira insuficiente' ELSE 'saiu de carteira insuficiente' END,round(novo_saldo,2),novos),
 'warning',jsonb_build_object('user_id',c.user_id,'symbol',c.symbol,'variant',c.variant,'mode',c.mode,
 'saldo_antes_brl',c.saldo_atual_brl,'saldo_brl',novo_saldo,'contratos_antes',c.contratos_atuais,'contratos',novos,'max_contracts',p_max,'origem',p_origem,'tipo',p_tipo));
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.b3_carteira_aplicar(uuid,numeric,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.b3_carteira_aplicar(uuid,numeric,integer,text,text) TO service_role;
-- Preserve exact four-argument resolution for existing triggers; never modify the order trigger.
CREATE OR REPLACE FUNCTION public.b3_carteira_aplicar(p_id uuid,p_delta numeric,p_max integer,p_origem text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $fn$
BEGIN
 PERFORM public.b3_carteira_aplicar(p_id,p_delta,p_max,p_origem,'resultado');
END $fn$;

CREATE FUNCTION public.b3_carteira_transferir(p_user_id uuid,p_symbol text,p_variant text,p_de_mode text DEFAULT NULL,p_para_mode text DEFAULT NULL,p_valor numeric DEFAULT NULL,p_motivo text DEFAULT NULL,p_previa boolean DEFAULT false,p_snapshot jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $fn$
DECLARE margem numeric; origem b3_carteira_robo; destino b3_carteira_robo; mx_de int; mx_para int;
 maximo numeric; de_depois numeric; para_depois numeric; de_ctr int; para_ctr int;
 capital numeric; contratos int; linhas jsonb; atual jsonb; dados jsonb; tid uuid;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id OR NOT public.is_owner() THEN RAISE EXCEPTION 'Apenas o dono pode mover saldo entre suas carteiras'; END IF;
 IF p_symbol IS NULL OR p_variant IS NULL THEN RAISE EXCEPTION 'Ativo e modalidade obrigatórios'; END IF;
 SELECT max(margin_per_contract_brl) INTO margem FROM b3_asset_profiles WHERE b3_carteira_raiz(symbol)=p_symbol AND margin_per_contract_brl > 0;
 IF margem IS NULL THEN RETURN jsonb_build_object('ok',false,'error','sem margem cadastrada para o ativo'); END IF;
 IF NOT p_previa THEN
 -- Stable lock order across the entire modality protects both wallets and the displayed totals.
 PERFORM id FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant ORDER BY id FOR UPDATE;
 END IF;
 SELECT coalesce(sum(saldo_atual_brl),0),coalesce(sum(contratos_atuais),0),coalesce(jsonb_agg(jsonb_build_object(
 'mode',mode,'saldo',saldo_atual_brl,'contratos',contratos_atuais,'estado',estado,
 'resultado_proprio',resultado_proprio_brl,'transferencias_liquidas',recebido_de_transferencias_brl,
 'maximo_doavel',greatest(0,saldo_atual_brl-margem*1.30),'atualizada_em',atualizada_em) ORDER BY mode),'[]'::jsonb)
 INTO capital,contratos,linhas FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant;
 atual := jsonb_build_object('rows',linhas,'margem',margem);
 dados := jsonb_build_object('ok',true,'symbol',p_symbol,'variant',p_variant,'rows',linhas,'capital_antes',capital,'capital_depois',capital,'contratos_antes',contratos,'snapshot',atual);
 IF p_previa AND p_de_mode IS NULL AND p_para_mode IS NULL THEN RETURN dados; END IF;
 IF p_de_mode IS NULL OR p_para_mode IS NULL OR p_de_mode=p_para_mode THEN RETURN jsonb_build_object('ok',false,'error','Escolha dois robôs diferentes da mesma modalidade'); END IF;
 IF p_valor IS NULL OR p_valor::text IN ('NaN','Infinity','-Infinity') OR p_valor<=0 THEN RETURN jsonb_build_object('ok',false,'error','O valor deve ser positivo'); END IF;
 IF p_motivo IS NULL OR length(btrim(p_motivo))=0 THEN RETURN jsonb_build_object('ok',false,'error','O motivo é obrigatório'); END IF;
 SELECT * INTO origem FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant AND mode=p_de_mode;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Origem não pertence a esta modalidade e ativo'); END IF;
 SELECT * INTO destino FROM b3_carteira_robo WHERE user_id=p_user_id AND symbol=p_symbol AND variant=p_variant AND mode=p_para_mode;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Destino não pertence a esta modalidade e ativo'); END IF;
 maximo := greatest(0,origem.saldo_atual_brl-margem*1.30);
 IF p_valor>maximo THEN RETURN jsonb_build_object('ok',false,'error','Valor acima do máximo permitido','maximo_permitido',maximo); END IF;
 SELECT s.max_contracts INTO mx_de FROM b3_simulation_mode_settings s JOIN b3_simulation_runs r ON r.id=s.simulation_run_id WHERE s.user_id=p_user_id AND b3_carteira_raiz(r.symbol)=p_symbol AND coalesce(r.variant,'indicador')=p_variant AND s.mode=p_de_mode ORDER BY (r.status='running') DESC,r.started_at DESC,s.id LIMIT 1;
 SELECT s.max_contracts INTO mx_para FROM b3_simulation_mode_settings s JOIN b3_simulation_runs r ON r.id=s.simulation_run_id WHERE s.user_id=p_user_id AND b3_carteira_raiz(r.symbol)=p_symbol AND coalesce(r.variant,'indicador')=p_variant AND s.mode=p_para_mode ORDER BY (r.status='running') DESC,r.started_at DESC,s.id LIMIT 1;
 de_depois := origem.saldo_atual_brl-p_valor; para_depois := destino.saldo_atual_brl+p_valor;
 de_ctr := b3_carteira_contratos(p_symbol,de_depois,coalesce(mx_de,1));
 para_ctr := b3_carteira_contratos(p_symbol,para_depois,coalesce(mx_para,1));
 IF de_ctr<1 THEN RETURN jsonb_build_object('ok',false,'error','A origem precisa manter capacidade para um contrato','maximo_permitido',maximo); END IF;
 dados := dados || jsonb_build_object('de_mode',p_de_mode,'para_mode',p_para_mode,'valor',p_valor,'motivo',btrim(p_motivo),
 'de_saldo_antes',origem.saldo_atual_brl,'de_saldo_depois',de_depois,'para_saldo_antes',destino.saldo_atual_brl,'para_saldo_depois',para_depois,
 'de_contratos_antes',origem.contratos_atuais,'de_contratos_depois',de_ctr,'para_contratos_antes',destino.contratos_atuais,'para_contratos_depois',para_ctr,
 'contratos_depois',contratos-origem.contratos_atuais-destino.contratos_atuais+de_ctr+para_ctr,
 'reduz_contratos',contratos-origem.contratos_atuais-destino.contratos_atuais+de_ctr+para_ctr < contratos);
 -- Configuration ceilings are part of the fresh confirmation snapshot too.
 atual := atual || jsonb_build_object('max_de',coalesce(mx_de,1),'max_para',coalesce(mx_para,1));
 dados := dados || jsonb_build_object('snapshot',atual);
 IF p_previa THEN RETURN dados; END IF;
 IF p_snapshot IS NOT NULL AND p_snapshot IS DISTINCT FROM atual THEN RETURN jsonb_build_object('ok',false,'error','Os saldos ou limites mudaram. Confira uma nova prévia antes de confirmar.'); END IF;
 IF origem.saldo_inicial_brl+origem.resultado_proprio_brl+origem.recebido_de_transferencias_brl <> origem.saldo_atual_brl OR destino.saldo_inicial_brl+destino.resultado_proprio_brl+destino.recebido_de_transferencias_brl <> destino.saldo_atual_brl THEN RAISE EXCEPTION 'Invariante da carteira divergente; transferência cancelada'; END IF;
 PERFORM b3_carteira_aplicar(origem.id,-p_valor,coalesce(mx_de,1),'transferencia:'||p_para_mode,'transferencia');
 PERFORM b3_carteira_aplicar(destino.id,p_valor,coalesce(mx_para,1),'transferencia:'||p_de_mode,'transferencia');
 IF EXISTS(SELECT 1 FROM b3_carteira_robo WHERE id IN (origem.id,destino.id) AND saldo_inicial_brl+resultado_proprio_brl+recebido_de_transferencias_brl <> saldo_atual_brl) THEN RAISE EXCEPTION 'Invariante da carteira divergente; transferência cancelada'; END IF;
 IF (SELECT sum(saldo_atual_brl) FROM b3_carteira_robo WHERE id IN (origem.id,destino.id)) <> origem.saldo_atual_brl+destino.saldo_atual_brl THEN RAISE EXCEPTION 'Capital divergente; transferência cancelada'; END IF;
 INSERT INTO b3_carteira_transferencia(user_id,symbol,variant,de_mode,para_mode,valor_brl,motivo,de_saldo_antes,de_saldo_depois,para_saldo_antes,para_saldo_depois,de_contratos_antes,de_contratos_depois,para_contratos_antes,para_contratos_depois,criada_por)
 VALUES(p_user_id,p_symbol,p_variant,p_de_mode,p_para_mode,p_valor,btrim(p_motivo),origem.saldo_atual_brl,de_depois,destino.saldo_atual_brl,para_depois,origem.contratos_atuais,de_ctr,destino.contratos_atuais,para_ctr,p_user_id::text) RETURNING id INTO tid;
 RETURN dados || jsonb_build_object('id',tid,'confirmada',true);
END $fn$;
REVOKE ALL ON FUNCTION public.b3_carteira_transferir(uuid,text,text,text,text,numeric,text,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.b3_carteira_transferir(uuid,text,text,text,text,numeric,text,boolean,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.b3_carteira_transferir(uuid,text,text,text,text,numeric,text,boolean,jsonb) TO service_role;