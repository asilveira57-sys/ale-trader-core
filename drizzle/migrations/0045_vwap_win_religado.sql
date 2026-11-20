-- VWAP religado no WIN (pedido do dono 20/11/2026): 8 robôs, carteira de R$ 10.000 cada,
-- confirmação de entrada (25% do stop em 180 s) e portão de setup válido ligados.
INSERT INTO b3_carteira_robo (user_id, symbol, variant, mode, saldo_inicial_brl, saldo_atual_brl, resultado_proprio_brl, recebido_de_transferencias_brl, contratos_atuais, estado)
SELECT '4974847b-db2c-44d3-adc9-4523b1c7ba1b', 'WIN', 'vwap', m, 10000, 10000, 0, 0, 1, 'ativa'
FROM unnest(ARRAY['agressivo','arrojado','cauteloso','conservador','enoir','equilibrado','moderado','semi_agressivo']) m
WHERE NOT EXISTS (SELECT 1 FROM b3_carteira_robo c WHERE c.symbol = 'WIN' AND c.variant = 'vwap' AND c.mode = m);
UPDATE b3_simulation_mode_settings
   SET enabled = true, exigir_setup_valido = true, confirmacao_ativa_simulado = true, confirmacao_pct_stop = 25, confirmacao_janela_s = 180
 WHERE simulation_run_id = 'ac641118-8ddb-4e03-95bb-3a9ab497d4ce';
UPDATE b3_simulation_runs SET status = 'running', updated_at = now()
 WHERE id = 'ac641118-8ddb-4e03-95bb-3a9ab497d4ce';
