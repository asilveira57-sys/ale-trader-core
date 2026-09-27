ALTER TABLE public.b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS daily_stop_mult numeric NOT NULL DEFAULT 3.0 CHECK (daily_stop_mult > 0 AND daily_stop_mult <= 20);

CREATE OR REPLACE FUNCTION public.b3_derivar_limite_diario()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_valor_ponto numeric;
BEGIN
  -- LIMITE DIARIO DERIVADO (18/08/2026): limite = multiplicador x stop x valor do ponto x contratos.
  -- CALIBRACAO (27/09/2026): o multiplicador sai de daily_stop_mult (padrao 3,0,
  -- identico ao valor fixo anterior). So muda quando o operador aplica uma sugestao.
  SELECT ap.tick_value_brl INTO v_valor_ponto
  FROM b3_asset_profiles ap
  JOIN b3_simulation_runs r ON r.symbol = ap.symbol
  WHERE r.id = NEW.simulation_run_id;

  IF v_valor_ponto IS NOT NULL AND NEW.stop_pts > 0 AND NEW.max_contracts > 0 THEN
    NEW.daily_loss_limit_brl := ROUND(COALESCE(NEW.daily_stop_mult, 3) * NEW.stop_pts * v_valor_ponto * NEW.max_contracts, 2);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_b3_derivar_limite_diario ON public.b3_simulation_mode_settings;
CREATE TRIGGER trg_b3_derivar_limite_diario BEFORE INSERT OR UPDATE OF stop_pts, max_contracts, daily_loss_limit_brl, daily_stop_mult ON public.b3_simulation_mode_settings FOR EACH ROW EXECUTE FUNCTION public.b3_derivar_limite_diario();