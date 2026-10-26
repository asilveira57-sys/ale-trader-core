CREATE TABLE public.b3_carteira_robo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,          -- raiz do ativo (WIN, WDO, BIT): sobrevive à rolagem do contrato
  variant text NOT NULL,
  mode text NOT NULL,
  saldo_inicial_brl numeric NOT NULL DEFAULT 300,
  saldo_atual_brl numeric NOT NULL DEFAULT 300,
  resultado_proprio_brl numeric NOT NULL DEFAULT 0,
  recebido_de_transferencias_brl numeric NOT NULL DEFAULT 0,
  contratos_atuais integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa','carteira_insuficiente')),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, variant, mode)
);
GRANT SELECT ON public.b3_carteira_robo TO authenticated;
GRANT ALL ON public.b3_carteira_robo TO service_role;
ALTER TABLE public.b3_carteira_robo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dono le a propria carteira" ON public.b3_carteira_robo FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.b3_carteira_raiz(s text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT upper(regexp_replace(coalesce(s,''), '[FGHJKMNQUVXZ]\d{2}$', '')) $$;

-- Escada: piso(saldo / (margem × 1,30)), teto max_contracts, piso 0. Margem cheia por robô.
CREATE OR REPLACE FUNCTION public.b3_carteira_contratos(p_raiz text, p_saldo numeric, p_max integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN m.margem IS NULL OR m.margem <= 0 THEN 0
    ELSE greatest(0, least(coalesce(p_max,0), floor(p_saldo / (m.margem * 1.30))::int)) END
  FROM (SELECT max(margin_per_contract_brl) AS margem FROM b3_asset_profiles
        WHERE b3_carteira_raiz(symbol) = p_raiz AND margin_per_contract_brl > 0) m
$$;

-- Aplica novo saldo/contratos e registra entrada/saída de "carteira insuficiente".
CREATE OR REPLACE FUNCTION public.b3_carteira_aplicar(p_id uuid, p_delta numeric, p_max integer, p_origem text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c b3_carteira_robo; novo_saldo numeric; novos int; novo_estado text;
BEGIN
  SELECT * INTO c FROM b3_carteira_robo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  novo_saldo := c.saldo_atual_brl + coalesce(p_delta,0);
  novos := b3_carteira_contratos(c.symbol, novo_saldo, p_max);
  novo_estado := CASE WHEN novos >= 1 THEN 'ativa' ELSE 'carteira_insuficiente' END;
  IF coalesce(p_delta,0) = 0 AND novos = c.contratos_atuais AND novo_estado = c.estado THEN RETURN; END IF;
  UPDATE b3_carteira_robo SET saldo_atual_brl = novo_saldo,
    resultado_proprio_brl = resultado_proprio_brl + coalesce(p_delta,0),
    contratos_atuais = novos, estado = novo_estado, atualizada_em = now()
  WHERE id = p_id;
  IF novo_estado <> c.estado THEN
    INSERT INTO system_logs(event_type, source, message, severity, technical_data) VALUES (
      CASE WHEN novo_estado = 'carteira_insuficiente' THEN 'carteira_robo_insuficiente' ELSE 'carteira_robo_recuperada' END,
      'b3_carteira_robo',
      format('%s %s (%s): %s — saldo R$ %s, %s contrato(s)', c.symbol, c.variant, c.mode,
        CASE WHEN novo_estado = 'carteira_insuficiente' THEN 'entrou em carteira insuficiente' ELSE 'saiu de carteira insuficiente' END,
        round(novo_saldo,2), novos),
      'warning',
      jsonb_build_object('user_id', c.user_id, 'symbol', c.symbol, 'variant', c.variant, 'mode', c.mode,
        'saldo_antes_brl', c.saldo_atual_brl, 'saldo_brl', novo_saldo, 'contratos_antes', c.contratos_atuais,
        'contratos', novos, 'max_contracts', p_max, 'origem', p_origem));
  END IF;
END $$;

-- Uma escrita por ordem fechada (ou por correção do resultado de ordem já fechada).
CREATE OR REPLACE FUNCTION public.b3_carteira_trg_ordem() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric; r record; cid uuid; mx int;
BEGIN
  IF NEW.status IS DISTINCT FROM 'closed' THEN RETURN NEW; END IF;
  delta := coalesce(NEW.net_result_brl,0)
    - CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN coalesce(OLD.net_result_brl,0) ELSE 0 END;
  IF delta = 0 THEN RETURN NEW; END IF;
  SELECT symbol, variant INTO r FROM b3_simulation_runs WHERE id = NEW.simulation_run_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT max_contracts INTO mx FROM b3_simulation_mode_settings
    WHERE simulation_run_id = NEW.simulation_run_id AND mode = NEW.mode LIMIT 1;
  INSERT INTO b3_carteira_robo(user_id, symbol, variant, mode)
    VALUES (NEW.user_id, b3_carteira_raiz(r.symbol), coalesce(r.variant,'indicador'), NEW.mode)
    ON CONFLICT (user_id, symbol, variant, mode) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING id INTO cid;
  PERFORM b3_carteira_aplicar(cid, delta, coalesce(mx,1), 'ordem_fechada:' || NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Carteira nunca pode impedir o fechamento da ordem; a falha fica registrada.
  INSERT INTO system_logs(event_type, source, message, severity, technical_data)
  VALUES ('carteira_robo_falha', 'b3_carteira_robo', SQLERRM, 'warning', jsonb_build_object('order_id', NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER b3_carteira_ordem_fechada AFTER INSERT OR UPDATE OF status, net_result_brl
  ON public.b3_simulation_orders FOR EACH ROW EXECUTE FUNCTION public.b3_carteira_trg_ordem();

-- Robô novo/habilitado ganha carteira; mudança de max_contracts recalcula a escada.
CREATE OR REPLACE FUNCTION public.b3_carteira_trg_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; cid uuid;
BEGIN
  IF NOT coalesce(NEW.enabled,false) THEN RETURN NEW; END IF;
  SELECT symbol, variant INTO r FROM b3_simulation_runs WHERE id = NEW.simulation_run_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO b3_carteira_robo(user_id, symbol, variant, mode)
    VALUES (NEW.user_id, b3_carteira_raiz(r.symbol), coalesce(r.variant,'indicador'), NEW.mode)
    ON CONFLICT (user_id, symbol, variant, mode) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING id INTO cid;
  PERFORM b3_carteira_aplicar(cid, 0, coalesce(NEW.max_contracts,1), 'configuracao');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO system_logs(event_type, source, message, severity, technical_data)
  VALUES ('carteira_robo_falha', 'b3_carteira_robo', SQLERRM, 'warning', jsonb_build_object('settings_id', NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER b3_carteira_settings AFTER INSERT OR UPDATE OF enabled, max_contracts
  ON public.b3_simulation_mode_settings FOR EACH ROW EXECUTE FUNCTION public.b3_carteira_trg_settings();

-- Semente: R$ 300 por robô habilitado, três ativos.
INSERT INTO public.b3_carteira_robo(user_id, symbol, variant, mode, contratos_atuais, estado)
SELECT DISTINCT ON (s.user_id, public.b3_carteira_raiz(r.symbol), coalesce(r.variant,'indicador'), s.mode)
  s.user_id, public.b3_carteira_raiz(r.symbol), coalesce(r.variant,'indicador'), s.mode,
  public.b3_carteira_contratos(public.b3_carteira_raiz(r.symbol), 300, coalesce(s.max_contracts,1)),
  CASE WHEN public.b3_carteira_contratos(public.b3_carteira_raiz(r.symbol), 300, coalesce(s.max_contracts,1)) >= 1 THEN 'ativa' ELSE 'carteira_insuficiente' END
FROM public.b3_simulation_mode_settings s JOIN public.b3_simulation_runs r ON r.id = s.simulation_run_id
WHERE s.enabled
ON CONFLICT DO NOTHING;