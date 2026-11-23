-- Etapa 1 "nenhum valor fixo" (OK do dono 23/11/2026). Converte cada valor fixo de todos os robôs
-- ativos na porcentagem EQUIVALENTE de hoje (nenhuma mudança de comportamento) e liga a chave:
--  · perda do dia, meta do dia e trava de pico: % da carteira do robô (b3_carteira_robo.saldo_atual_brl);
--  · trailing (ativação e devolução) e zero a zero (ativação e folga): % do stop do robô;
--  · piso de estrutura do price action: % do stop.
-- Aplicada depois do fechamento do pregão, com o código novo (base = carteira) já publicado.
UPDATE b3_simulation_mode_settings s SET
  daily_loss_limit_pct      = CASE WHEN c.saldo_atual_brl > 0 AND s.daily_loss_limit_brl > 0 THEN round(s.daily_loss_limit_brl / c.saldo_atual_brl * 100, 4) ELSE s.daily_loss_limit_pct END,
  daily_gain_target_pct     = CASE WHEN c.saldo_atual_brl > 0 AND s.daily_gain_target_brl > 0 THEN round(s.daily_gain_target_brl / c.saldo_atual_brl * 100, 4) ELSE s.daily_gain_target_pct END,
  peak_lock_min_profit_pct  = CASE WHEN c.saldo_atual_brl > 0 AND s.peak_lock_min_profit_brl > 0 THEN round(s.peak_lock_min_profit_brl / c.saldo_atual_brl * 100, 4) ELSE s.peak_lock_min_profit_pct END,
  trailing_activation_pct_stop = CASE WHEN s.stop_pts > 0 AND s.trailing_activation_pts > 0 THEN round(s.trailing_activation_pts / s.stop_pts * 100, 4) ELSE s.trailing_activation_pct_stop END,
  trailing_giveback_pct_stop   = CASE WHEN s.stop_pts > 0 AND s.trailing_giveback_pts > 0 THEN round(s.trailing_giveback_pts / s.stop_pts * 100, 4) ELSE s.trailing_giveback_pct_stop END,
  breakeven_ativa_pct_stop     = coalesce(s.breakeven_ativa_pct_stop, CASE WHEN s.stop_pts > 0 AND s.breakeven_ativa_pts > 0 THEN round(s.breakeven_ativa_pts / s.stop_pts * 100, 4) END),
  breakeven_folga_pct_stop     = coalesce(s.breakeven_folga_pct_stop, CASE WHEN s.stop_pts > 0 AND s.breakeven_folga_pts > 0 THEN round(s.breakeven_folga_pts / s.stop_pts * 100, 4) END),
  pa_near_struct_piso_pct_stop = CASE WHEN s.stop_pts > 0 AND s.pa_near_struct_piso_pts > 0 THEN round(s.pa_near_struct_piso_pts / s.stop_pts * 100, 4) ELSE s.pa_near_struct_piso_pct_stop END,
  limites_proporcionais = true,
  updated_at = now()
FROM b3_simulation_runs r, b3_carteira_robo c
WHERE r.id = s.simulation_run_id AND r.status = 'running'
  AND c.user_id = s.user_id AND c.symbol = left(r.symbol, 3) AND c.variant = coalesce(r.variant, 'indicador') AND c.mode = s.mode;
