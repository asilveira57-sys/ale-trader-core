CREATE OR REPLACE FUNCTION public.b3_cores_dos_robos()
RETURNS TABLE(symbol text, variant text, mode text, cor text, streak_days integer, neg_streak integer, medal boolean, caiu_de_verde_em date, rank_day integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ult AS (
    SELECT max(trade_date) AS d FROM public.b3_robot_daily_score WHERE user_id = auth.uid()
  ), r AS (
    SELECT s.symbol, s.variant, s.mode, s.rank_day
    FROM public.b3_robot_daily_score s, ult
    WHERE s.user_id = auth.uid() AND s.trade_date = ult.d
  )
  SELECT c.symbol, c.variant, c.mode,
         public.b3_cor_do_robo(c.streak_days, c.neg_streak, c.medal, c.caiu_de_verde_em, r.rank_day) AS cor,
         c.streak_days, c.neg_streak, c.medal, c.caiu_de_verde_em, r.rank_day
  FROM public.b3_robot_curation c
  LEFT JOIN r ON r.symbol = c.symbol AND r.variant = c.variant AND r.mode = c.mode
  WHERE c.user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.b3_cores_dos_robos() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.b3_cores_dos_robos() FROM anon;