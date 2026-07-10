CREATE OR REPLACE FUNCTION public.b3_enforce_mt5_execution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mt5_active boolean;
  rounded_bid numeric;
  rounded_ask numeric;
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

  IF COALESCE(NEW.status, '') IN ('cancelled', 'rejected', 'legacy_invalidated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.status, '') = 'closed'
     AND (
       COALESCE(OLD.quote_source, '') <> 'MT5 XP DEMO'
       OR COALESCE(OLD.provider_name, '') <> 'B3QuoteProvider'
       OR COALESCE(OLD.quote_server, '') <> 'XPMT5-DEMO'
       OR COALESCE(OLD.quote_symbol, '') <> 'WINQ26'
       OR COALESCE(OLD.legacy_price_detected, true) IS DISTINCT FROM false
     )
  THEN
    RAISE EXCEPTION 'Tentativa de fechar operação legada como MT5 bloqueada — modo MT5 XP DEMO ativo';
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

  rounded_bid := round(NEW.quote_bid / 5) * 5;
  rounded_ask := round(NEW.quote_ask / 5) * 5;

  IF NEW.execution_price NOT IN (rounded_bid, rounded_ask) THEN
    RAISE EXCEPTION 'Preço de execução incompatível com Bid/Ask MT5 — operação bloqueada';
  END IF;

  IF abs(NEW.execution_price - NEW.quote_last) > 2000 THEN
    RAISE EXCEPTION 'Preço de execução incompatível com último MT5 — operação bloqueada';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.b3_enforce_mt5_execution_audit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.b3_enforce_mt5_execution_audit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.b3_enforce_mt5_execution_audit() FROM authenticated;