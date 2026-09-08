CREATE OR REPLACE FUNCTION public.b3_prd_atualizar_parametros(
  p_user_id uuid,
  p_symbol text,
  p_variant text,
  p_mode text,
  p_max_qty integer,
  p_max_daily_loss_brl numeric,
  p_max_daily_loss_mult numeric,
  p_origem text,
  p_sessao_id text
)
RETURNS TABLE(id uuid, symbol text, variant text, mode text, enabled boolean, max_qty integer, max_daily_loss_brl numeric, max_daily_loss_mult numeric, magic_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mesma transação do UPDATE: o gatilho de auditoria lê estes valores.
  PERFORM set_config('app.origem', coalesce(p_origem, 'painel'), true);
  PERFORM set_config('app.sessao_id', coalesce(p_sessao_id, ''), true);

  RETURN QUERY
  UPDATE public.b3_prd_authorizations a
     SET max_qty = p_max_qty,
         max_daily_loss_brl = p_max_daily_loss_brl,
         max_daily_loss_mult = p_max_daily_loss_mult,
         updated_at = now()
   WHERE a.user_id = p_user_id
     AND a.symbol = p_symbol
     AND coalesce(a.variant, 'indicador') = coalesce(p_variant, 'indicador')
     AND a.mode = p_mode
  RETURNING a.id, a.symbol, a.variant, a.mode, a.enabled, a.max_qty,
            a.max_daily_loss_brl, a.max_daily_loss_mult, a.magic_number;
END $$;

REVOKE ALL ON FUNCTION public.b3_prd_atualizar_parametros(uuid, text, text, text, integer, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b3_prd_atualizar_parametros(uuid, text, text, text, integer, numeric, numeric, text, text) TO service_role;
