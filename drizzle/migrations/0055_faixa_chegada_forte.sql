-- 0055 — Faixa: chegada forte à borda (decisão do dono 24/11/2026, livreto 155).
-- range_exaustao_min: eficiência direcional mínima, CONTRA a operação, nos últimos
-- range_exaustao_janela_min minutos (vazio = desligado). WIN faixa, 8 robôs: 0,5 em 60 min.
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS range_exaustao_min numeric;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS range_exaustao_janela_min integer;
UPDATE b3_simulation_mode_settings s SET range_exaustao_min = 0.5, range_exaustao_janela_min = 60, updated_at = now()
FROM b3_simulation_runs r
WHERE r.id = s.simulation_run_id AND r.symbol IN ('WIN','WINZ26') AND r.variant = 'range' AND r.status = 'running';
