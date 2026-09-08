-- 1) magic explícito na autorização, derivado da MESMA fonte do comando (public.b3_magic)
ALTER TABLE public.b3_prd_authorizations
  ADD COLUMN IF NOT EXISTS magic_number integer;

CREATE OR REPLACE FUNCTION public.b3_prd_auth_preencher_magic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m integer;
BEGIN
  BEGIN
    m := public.b3_magic(NEW.symbol, coalesce(NEW.variant, 'indicador'), NEW.mode);
  EXCEPTION WHEN OTHERS THEN
    m := NULL;
  END;
  IF m IS NOT NULL AND m > 0 THEN
    NEW.magic_number := m;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_b3_prd_auth_magic ON public.b3_prd_authorizations;
CREATE TRIGGER trg_b3_prd_auth_magic
  BEFORE INSERT OR UPDATE OF symbol, variant, mode ON public.b3_prd_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.b3_prd_auth_preencher_magic();

UPDATE public.b3_prd_authorizations a
   SET magic_number = public.b3_magic(a.symbol, coalesce(a.variant, 'indicador'), a.mode)
 WHERE a.magic_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS b3_prd_authorizations_user_magic_uidx
  ON public.b3_prd_authorizations (user_id, magic_number)
  WHERE magic_number IS NOT NULL;

-- 2) registro completo: modalidade, limite de perda e sessão de edição
ALTER TABLE public.b3_prd_authorization_log
  ADD COLUMN IF NOT EXISTS sessao_id text,
  ADD COLUMN IF NOT EXISTS de_max_daily_loss_brl numeric,
  ADD COLUMN IF NOT EXISTS para_max_daily_loss_brl numeric;

CREATE OR REPLACE FUNCTION public.b3_prd_auth_registra_mudanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       OLD.enabled IS DISTINCT FROM NEW.enabled
    OR OLD.max_qty IS DISTINCT FROM NEW.max_qty
    OR OLD.max_daily_loss_brl IS DISTINCT FROM NEW.max_daily_loss_brl
  ) THEN
    INSERT INTO b3_prd_authorization_log (
      user_id, symbol, variant, mode,
      de_enabled, para_enabled, de_max_qty, para_max_qty,
      de_max_daily_loss_brl, para_max_daily_loss_brl,
      origem, sessao_id
    )
    VALUES (
      NEW.user_id, NEW.symbol, coalesce(NEW.variant, 'indicador'), NEW.mode,
      OLD.enabled, NEW.enabled, OLD.max_qty, NEW.max_qty,
      OLD.max_daily_loss_brl, NEW.max_daily_loss_brl,
      coalesce(current_setting('app.origem', true), 'desconhecida'),
      nullif(current_setting('app.sessao_id', true), '')
    );
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $function$;
