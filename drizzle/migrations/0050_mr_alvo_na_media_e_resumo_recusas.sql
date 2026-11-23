-- 23/11/2026 (OK do dono, todos os robôs, sem metade):
-- 1) Reversão à média WIN: alvo = distância até a média, stop = 1,5× essa distância, esticão mínimo 0,10% do preço,
--    exige as 3 evidências de exaustão. gain_pts/stop_pts fixos (e o corte de 60% de 19/10) deixam de valer.
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS mr_alvo_na_media boolean;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS mr_stop_mult_dist numeric;
ALTER TABLE b3_simulation_mode_settings ADD COLUMN IF NOT EXISTS mr_min_stretch_pct_preco numeric;
UPDATE b3_simulation_mode_settings s SET mr_alvo_na_media = true, mr_stop_mult_dist = 1.5, mr_min_stretch_pct_preco = 0.10
  FROM b3_simulation_runs r WHERE r.id = s.simulation_run_id AND r.status = 'running' AND r.symbol = 'WINZ26' AND r.variant = 'mean_reversion';
-- 2) Resumo diário das recusas (robô × motivo × quantidade), gravado às 18h45 antes da retenção apagar o log.
CREATE TABLE IF NOT EXISTS b3_recusas_resumo_dia (
  dia date NOT NULL, user_id uuid NOT NULL, symbol text NOT NULL, variant text NOT NULL, mode text NOT NULL,
  estagio text NOT NULL, motivo text NOT NULL, quantidade integer NOT NULL,
  PRIMARY KEY (dia, user_id, symbol, variant, mode, estagio, motivo));
ALTER TABLE b3_recusas_resumo_dia ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'b3_recusas_resumo_dia') THEN
    CREATE POLICY "dono le resumo de recusas" ON b3_recusas_resumo_dia FOR SELECT USING (auth.uid() = user_id);
  END IF; END $$;
CREATE OR REPLACE FUNCTION b3_resumir_recusas_dia(p_dia date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH ins AS (
    INSERT INTO b3_recusas_resumo_dia (dia, user_id, symbol, variant, mode, estagio, motivo, quantidade)
    SELECT l.trade_date, l.user_id, left(l.symbol,3), coalesce(r.variant,'indicador'), l.mode, l.estagio,
           left(regexp_replace(l.motivo, '[0-9]+([.,][0-9]+)?', '#', 'g'), 160), count(*)
    FROM b3_entry_decision_log l JOIN b3_simulation_runs r ON r.id = l.simulation_run_id
    WHERE l.trade_date = p_dia
    GROUP BY 1,2,3,4,5,6,7
    ON CONFLICT (dia, user_id, symbol, variant, mode, estagio, motivo) DO UPDATE SET quantidade = excluded.quantidade
    RETURNING 1)
  SELECT count(*)::int FROM ins;
$f$;
SELECT cron.schedule('b3_resumo_recusas', '45 21 * * 1-5', 'select public.b3_resumir_recusas_dia();');
