-- Rompimento WIN (dono 20/11/2026): canal de 30/40 min nos 8 robôs e mínimos proporcionais ao stop.
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS range_lookback_candles integer;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS breakout_min_clearance_pct_stop numeric;
COMMENT ON COLUMN b3_simulation_mode_settings.range_lookback_candles IS 'Tamanho do canal (velas de 1 min) da faixa/rompimento. Nulo = 20.';
COMMENT ON COLUMN b3_simulation_mode_settings.breakout_min_clearance_pct_stop IS 'Rompimento: folga mínima além da borda em % do stop_pts. Preenchido, substitui breakout_min_clearance_pts.';
UPDATE b3_simulation_mode_settings s SET
  range_lookback_candles = CASE WHEN s.mode IN ('cauteloso','equilibrado','arrojado','enoir') THEN 40 ELSE 30 END,
  range_min_size_pct_stop = CASE s.mode WHEN 'agressivo' THEN 125 WHEN 'arrojado' THEN 106 WHEN 'cauteloso' THEN 203 WHEN 'conservador' THEN 241 WHEN 'equilibrado' THEN 128 WHEN 'moderado' THEN 175 WHEN 'semi_agressivo' THEN 93 ELSE 150 END,
  breakout_min_clearance_pct_stop = CASE s.mode WHEN 'agressivo' THEN 8 WHEN 'arrojado' THEN 7 WHEN 'cauteloso' THEN 14 WHEN 'conservador' THEN 16 WHEN 'equilibrado' THEN 9 WHEN 'moderado' THEN 12 WHEN 'semi_agressivo' THEN 7 ELSE 10 END
FROM b3_simulation_runs r
WHERE r.id = s.simulation_run_id AND r.status = 'running' AND r.symbol = 'WINZ26' AND r.variant = 'rompimento';
