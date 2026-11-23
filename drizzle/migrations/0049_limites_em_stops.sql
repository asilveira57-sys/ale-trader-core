-- Dono 23/11/2026: limites em dinheiro por 1 CONTRATO, em múltiplos do stop do robô (não da carteira fictícia).
-- Substitui a parte "% da carteira" da 0048 (que não foi aplicada). Mesmos valores de hoje.
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS daily_loss_limit_stops numeric;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS daily_gain_target_stops numeric;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS peak_lock_min_profit_stops numeric;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS pa_near_struct_piso_pct_stop numeric;
UPDATE b3_simulation_mode_settings s SET
  daily_loss_limit_stops     = CASE WHEN s.daily_loss_limit_brl > 0 THEN round(s.daily_loss_limit_brl / (s.stop_pts * a.tick_value_brl), 4) END,
  daily_gain_target_stops    = CASE WHEN s.daily_gain_target_brl > 0 THEN round(s.daily_gain_target_brl / (s.stop_pts * a.tick_value_brl), 4) END,
  peak_lock_min_profit_stops = CASE WHEN s.peak_lock_min_profit_brl > 0 THEN round(s.peak_lock_min_profit_brl / (s.stop_pts * a.tick_value_brl), 4) END,
  trailing_activation_pct_stop = CASE WHEN s.trailing_activation_pts > 0 THEN round(s.trailing_activation_pts / s.stop_pts * 100, 4) ELSE s.trailing_activation_pct_stop END,
  trailing_giveback_pct_stop   = CASE WHEN s.trailing_giveback_pts > 0 THEN round(s.trailing_giveback_pts / s.stop_pts * 100, 4) ELSE s.trailing_giveback_pct_stop END,
  breakeven_ativa_pct_stop     = coalesce(s.breakeven_ativa_pct_stop, CASE WHEN s.breakeven_ativa_pts > 0 THEN round(s.breakeven_ativa_pts / s.stop_pts * 100, 4) END),
  breakeven_folga_pct_stop     = coalesce(s.breakeven_folga_pct_stop, CASE WHEN s.breakeven_folga_pts > 0 THEN round(s.breakeven_folga_pts / s.stop_pts * 100, 4) END),
  pa_near_struct_piso_pct_stop = CASE WHEN s.pa_near_struct_piso_pts > 0 THEN round(s.pa_near_struct_piso_pts / s.stop_pts * 100, 4) END,
  daily_loss_limit_pct = NULL, daily_gain_target_pct = NULL, peak_lock_min_profit_pct = NULL,
  limites_proporcionais = true, updated_at = now()
FROM b3_simulation_runs r, b3_asset_profiles a
WHERE r.id = s.simulation_run_id AND r.status = 'running' AND s.stop_pts > 0
  AND a.symbol = r.symbol AND a.tick_value_brl > 0;
-- Acumulado legado zerado no reset de 12/11: saldo do robô = R$ 10.000 + resultado desde então (carteira).
UPDATE b3_simulation_modes m SET initial_balance = 10000, current_balance = c.saldo_atual_brl
FROM b3_simulation_runs r, b3_carteira_robo c
WHERE r.id = m.simulation_run_id AND r.status = 'running'
  AND c.user_id = r.user_id AND c.symbol = left(r.symbol, 3) AND c.variant = coalesce(r.variant, 'indicador') AND c.mode = m.mode;
