-- 0053 — WIN price action sem confirmação: régua solta nos 8 robôs (decisão do dono 24/11/2026).
-- Fim do teste A/B de 20/11 (migration 0043, livreto 146). Regra do dono (livreto 145):
-- nada de teste com metade dos robôs; muda tudo ou nada. Placar 23–24/11 por 1 contrato:
-- solto +1.150 (36 entradas) contra antigo +264 (17). Aplicado direto no banco em 24/11.
UPDATE b3_simulation_mode_settings s
SET pa_eficiencia_min = 0.20, pa_posicao_max_compra = 0.80, pa_posicao_min_venda = 0.20, updated_at = now()
FROM b3_simulation_runs r
WHERE r.id = s.simulation_run_id AND r.symbol IN ('WIN','WINZ26') AND r.variant = 'price_action_sc' AND r.status = 'running'
  AND s.mode IN ('agressivo_sc','conservador_sc','moderado_sc','semi_agressivo_sc');
