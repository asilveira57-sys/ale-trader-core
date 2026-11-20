-- Teste A/B no WIN price action SEM confirmação (pedido do dono 20/11/2026, livreto 146).
-- Grupo solto: Cauteloso, Equilibrado, Arrojado, Enoir. Controle: os outros 4 (0,30 / 0,65 / 0,35).
UPDATE b3_simulation_mode_settings s
   SET pa_eficiencia_min = 0.20, pa_posicao_max_compra = 0.80, pa_posicao_min_venda = 0.20
  FROM b3_simulation_runs r
 WHERE r.id = s.simulation_run_id AND r.status = 'running' AND r.symbol = 'WINZ26' AND r.variant = 'price_action_sc'
   AND s.mode IN ('cauteloso_sc','equilibrado_sc','arrojado_sc','enoir_sc');
