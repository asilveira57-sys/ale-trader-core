-- Faixa (range) do WIN corrigida em todos os 8 modos (pedido do dono 18/11/2026).
-- 1) Faixa mínima proporcional ao stop: range_min_size_pct_stop = 300 (3× o stop), no lugar do valor fixo.
-- 2) Zero a zero: stop vai para o preço de entrada quando o preço anda 50% do stop a favor.
-- Simulação 13–18/11 (1 contrato): real −1.771 → +1.742 (110 entradas).
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS range_min_size_pct_stop numeric;
COMMENT ON COLUMN b3_simulation_mode_settings.range_min_size_pct_stop IS 'Faixa mínima (modalidade range) em % do stop_pts. Preenchido, substitui range_min_size_pts. 300 = faixa de pelo menos 3x o stop.';
UPDATE b3_simulation_mode_settings s
   SET range_min_size_pct_stop = 300, limites_proporcionais = true, breakeven_ativa_pct_stop = 50
  FROM b3_simulation_runs r
 WHERE r.id = s.simulation_run_id AND r.status = 'running' AND r.variant = 'range' AND r.symbol = 'WINZ26';
