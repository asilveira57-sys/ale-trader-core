-- Fim do teste A/B do livreto 143 (20/11/2026, OK do dono): régua solta nos 8 robôs do WIN price action com confirmação.
UPDATE b3_simulation_mode_settings s
   SET pa_eficiencia_min = 0.20, pa_posicao_max_compra = 0.80, pa_posicao_min_venda = 0.20
  FROM b3_simulation_runs r
 WHERE r.id = s.simulation_run_id AND r.status = 'running' AND r.symbol = 'WINZ26' AND r.variant = 'price_action';
