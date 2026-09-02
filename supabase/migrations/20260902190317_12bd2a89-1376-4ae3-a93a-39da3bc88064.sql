ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS unrealized_points numeric,
  ADD COLUMN IF NOT EXISTS unrealized_brl numeric;

CREATE OR REPLACE FUNCTION public.b3_enforce_mt5_execution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  mt5_active boolean;
  rounded_bid numeric;
  rounded_ask numeric;
  v_tick numeric;
  v_dev numeric;
  v_tol numeric;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.b3_trading_settings s
    WHERE s.user_id = NEW.user_id AND s.price_source = 'mt5_xp_demo'
  ) INTO mt5_active;

  IF NOT mt5_active THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status, '') IN ('cancelled', 'rejected', 'legacy_invalidated') THEN
    RETURN NEW;
  END IF;

  SELECT ap.tick_size, ap.price_deviation_limit INTO v_tick, v_dev
  FROM public.b3_asset_profiles ap
  WHERE ap.symbol = COALESCE(NEW.quote_symbol, '') AND ap.active;

  IF v_tick IS NULL OR v_tick <= 0 THEN
    RAISE EXCEPTION 'Simbolo % nao e ativo cadastrado em b3_asset_profiles — execucao bloqueada', COALESCE(NEW.quote_symbol, '(nulo)');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(NEW.status, '') = 'closed'
       AND (
         COALESCE(OLD.quote_source, '') <> 'MT5 XP DEMO'
         OR COALESCE(OLD.provider_name, '') <> 'B3QuoteProvider'
         OR COALESCE(OLD.quote_server, '') <> 'XPMT5-DEMO'
         OR NOT EXISTS (SELECT 1 FROM public.b3_asset_profiles ap2
                        WHERE ap2.symbol = COALESCE(OLD.quote_symbol, '') AND ap2.active)
         OR COALESCE(OLD.legacy_price_detected, true) IS DISTINCT FROM false
       )
    THEN
      RAISE EXCEPTION 'Tentativa de fechar operacao legada como MT5 bloqueada — modo MT5 XP DEMO ativo (simbolo=%)', COALESCE(OLD.quote_symbol, '(nulo)');
    END IF;
  END IF;

  IF COALESCE(NEW.quote_source, '') <> 'MT5 XP DEMO'
     OR COALESCE(NEW.provider_name, '') <> 'B3QuoteProvider'
     OR COALESCE(NEW.quote_server, '') <> 'XPMT5-DEMO'
     OR COALESCE(NEW.legacy_price_detected, true) IS DISTINCT FROM false
     OR NEW.quote_bid IS NULL
     OR NEW.quote_ask IS NULL
     OR NEW.quote_last IS NULL
     OR NEW.execution_price IS NULL
  THEN
    RAISE EXCEPTION 'Tentativa de preco legado bloqueada — modo MT5 XP DEMO ativo (simbolo=%; source=%; server=%; provider=%; legacy=%)',
      COALESCE(NEW.quote_symbol, '(nulo)'), COALESCE(NEW.quote_source, '(nulo)'),
      COALESCE(NEW.quote_server, '(nulo)'), COALESCE(NEW.provider_name, '(nulo)'),
      COALESCE(NEW.legacy_price_detected::text, '(nulo)');
  END IF;

  -- Normalizacao ao passo minimo do instrumento ANTES de validar e de persistir.
  -- Sem isso, residuo de ponto flutuante vindo da aplicacao (41.230000000000004)
  -- fazia a comparacao com bid/ask arredondados falhar por uma casa decimal
  -- que nao existe economicamente.
  NEW.execution_price := round(NEW.execution_price / v_tick) * v_tick;
  IF NEW.entry_price IS NOT NULL THEN
    NEW.entry_price := round(NEW.entry_price / v_tick) * v_tick;
  END IF;
  IF NEW.exit_price IS NOT NULL THEN
    NEW.exit_price := round(NEW.exit_price / v_tick) * v_tick;
  END IF;

  rounded_bid := round(NEW.quote_bid / v_tick) * v_tick;
  rounded_ask := round(NEW.quote_ask / v_tick) * v_tick;
  v_tol := v_tick / 2;

  IF abs(NEW.execution_price - rounded_bid) > v_tol
     AND abs(NEW.execution_price - rounded_ask) > v_tol THEN
    RAISE EXCEPTION 'Preco de execucao incompativel com Bid/Ask MT5 — operacao bloqueada (simbolo=%; tick=%; exec=%; bid_arred=%; ask_arred=%)',
      NEW.quote_symbol, v_tick, NEW.execution_price, rounded_bid, rounded_ask;
  END IF;

  IF abs(NEW.execution_price - NEW.quote_last) > COALESCE(v_dev, 2000) THEN
    RAISE EXCEPTION 'Preco de execucao incompativel com ultimo MT5 — operacao bloqueada (simbolo=%; exec=%; last=%; limite=%)',
      NEW.quote_symbol, NEW.execution_price, NEW.quote_last, COALESCE(v_dev, 2000);
  END IF;

  RETURN NEW;
END;
$function$;