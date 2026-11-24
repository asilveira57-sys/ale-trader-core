-- 0054 — WIN price action COM confirmação: confirmação em 15% do stop nos 8 robôs
-- (era 25%; janela segue 180 s). Decisão do dono 24/11/2026, livreto 153.
-- Referência de comparação: price_action_sc (mesma configuração, sem confirmação).
UPDATE b3_simulation_mode_settings s SET confirmacao_pct_stop = 15, updated_at = now()
FROM b3_simulation_runs r
WHERE r.id = s.simulation_run_id AND r.symbol IN ('WIN','WINZ26') AND r.variant = 'price_action' AND r.status = 'running';
