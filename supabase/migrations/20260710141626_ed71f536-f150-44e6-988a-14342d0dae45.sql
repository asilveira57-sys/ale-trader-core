CREATE OR REPLACE FUNCTION public.b3_enforce_mt5_execution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mt5_active boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.b3_trading_settings s
    WHERE s.user_id = NEW.user_id
      AND s.price_source = 'mt5_xp_demo'
  ) INTO mt5_active;

  IF NOT mt5_active THEN
    RETURN NEW;
  END IF;

  -- Operações canceladas/rejeitadas/invalidada-legado precisam continuar possíveis
  -- para limpar estado antigo sem recalcular PnL.
  IF COALESCE(NEW.status, '') IN ('cancelled', 'rejected', 'legacy_invalidated') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.quote_source, '') <> 'MT5 XP DEMO'
     OR COALESCE(NEW.provider_name, '') <> 'B3QuoteProvider'
     OR COALESCE(NEW.quote_server, '') <> 'XPMT5-DEMO'
     OR COALESCE(NEW.quote_symbol, '') <> 'WINQ26'
     OR COALESCE(NEW.legacy_price_detected, true) IS DISTINCT FROM false
     OR NEW.quote_bid IS NULL
     OR NEW.quote_ask IS NULL
     OR NEW.quote_last IS NULL
     OR NEW.execution_price IS NULL
  THEN
    RAISE EXCEPTION 'Tentativa de preço legado bloqueada — modo MT5 XP DEMO ativo';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b3_simulation_orders_mt5_execution_audit ON public.b3_simulation_orders;
CREATE TRIGGER trg_b3_simulation_orders_mt5_execution_audit
BEFORE INSERT OR UPDATE ON public.b3_simulation_orders
FOR EACH ROW
EXECUTE FUNCTION public.b3_enforce_mt5_execution_audit();

DROP TRIGGER IF EXISTS trg_b3_orders_mt5_execution_audit ON public.b3_orders;
CREATE TRIGGER trg_b3_orders_mt5_execution_audit
BEFORE INSERT OR UPDATE ON public.b3_orders
FOR EACH ROW
EXECUTE FUNCTION public.b3_enforce_mt5_execution_audit();