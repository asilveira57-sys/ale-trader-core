ALTER TABLE public.b3_prd_authorizations
  ADD COLUMN IF NOT EXISTS max_daily_loss_mult numeric;

COMMENT ON COLUMN public.b3_prd_authorizations.max_daily_loss_mult IS
  'Perda diaria maxima em multiplos de stop (adimensional). max_daily_loss_brl continua sendo a fonte em R$ usada pelo portao de perda; as duas ficam em sincronia.';

-- Deriva o multiplicador das linhas antigas: reais / (stop_pts * valor_do_ponto * max_qty).
WITH cfg AS (
  SELECT DISTINCT ON (r.user_id, r.symbol, s.entry_style, s.mode)
    r.user_id, r.symbol AS run_symbol, COALESCE(s.entry_style, 'indicador') AS variant, s.mode,
    s.stop_pts
  FROM public.b3_simulation_mode_settings s
  JOIN public.b3_simulation_runs r ON r.id = s.simulation_run_id
  ORDER BY r.user_id, r.symbol, s.entry_style, s.mode, r.started_at DESC
)
UPDATE public.b3_prd_authorizations a
SET max_daily_loss_mult = ROUND((a.max_daily_loss_brl / NULLIF(cfg.stop_pts * p.tick_value_brl * GREATEST(a.max_qty, 1), 0))::numeric, 2)
FROM cfg
JOIN public.b3_asset_profiles p ON TRUE
WHERE a.max_daily_loss_mult IS NULL
  AND a.user_id = cfg.user_id
  AND COALESCE(a.variant, 'indicador') = cfg.variant
  AND a.mode = cfg.mode
  AND p.symbol = regexp_replace(upper(a.symbol), '^([A-Z]{3})[FGHJKMNQUVXZ][0-9]{2}$', '\1')
  AND regexp_replace(upper(cfg.run_symbol), '^([A-Z]{3})[FGHJKMNQUVXZ][0-9]{2}$', '\1') = regexp_replace(upper(a.symbol), '^([A-Z]{3})[FGHJKMNQUVXZ][0-9]{2}$', '\1')
  AND a.max_daily_loss_brl > 0
  AND cfg.stop_pts > 0;