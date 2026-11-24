-- 0052 — Histórico permanente da confirmação de entrada (pedido do dono 24/11/2026).
-- b3_entry_decision_log é apagado em 4 dias e o CSV resumido do Drive troca os
-- números por '#'. Esta tabela guarda, para sempre e linha a linha, cada sinal
-- que esperou confirmação (todos os ativos, modalidades e robôs): preço do sinal,
-- exigido, melhor avanço na janela, tempos e os degraus em % do stop.
-- Só medição: nada do motor lê esta tabela. Livreto 152.

CREATE TABLE IF NOT EXISTS b3_confirmacao_hist (
  log_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  criado_em timestamptz NOT NULL,
  trade_date date,
  symbol text,
  simulation_run_id uuid,
  simulation_mode_id uuid,
  mode text,
  entry_style text,
  estagio text NOT NULL,
  lado text,
  side text,
  preco_sinal numeric,
  exigido_pts numeric,
  stop_pts numeric,
  gain_pts numeric,
  janela_s integer,
  andou_pts_janela numeric,
  andou_pts_total numeric,
  decorrido_s numeric,
  sinal_em timestamptz,
  confirmou_em timestamptz,
  preco_confirmacao numeric,
  simulation_order_id uuid,
  degraus jsonb,
  detalhe jsonb
);
CREATE INDEX IF NOT EXISTS b3_confirmacao_hist_dia ON b3_confirmacao_hist (trade_date, symbol, entry_style);
ALTER TABLE b3_confirmacao_hist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'b3_confirmacao_hist') THEN
    CREATE POLICY "dono le historico de confirmacao" ON b3_confirmacao_hist FOR SELECT USING (auth.uid() = user_id);
  END IF; END $$;

CREATE OR REPLACE FUNCTION b3_confirmacao_hist_copiar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE d jsonb := coalesce(NEW.detalhe, '{}'::jsonb);
BEGIN
  INSERT INTO b3_confirmacao_hist (log_id, user_id, criado_em, trade_date, symbol, simulation_run_id, simulation_mode_id,
    mode, entry_style, estagio, lado, side, preco_sinal, exigido_pts, stop_pts, gain_pts, janela_s,
    andou_pts_janela, andou_pts_total, decorrido_s, sinal_em, confirmou_em, preco_confirmacao, simulation_order_id, degraus, detalhe)
  VALUES (NEW.id, NEW.user_id, NEW.created_at, NEW.trade_date, NEW.symbol, NEW.simulation_run_id, NEW.simulation_mode_id,
    NEW.mode, NEW.entry_style, NEW.estagio, d->>'lado', d->>'side',
    nullif(d->>'preco_sinal','')::numeric, nullif(d->>'exigido_pts','')::numeric,
    nullif(d->>'stop_pts','')::numeric, nullif(d->>'gain_pts','')::numeric, nullif(d->>'janela_s','')::numeric::int,
    coalesce(nullif(d->>'andou_pts_na_janela','')::numeric, nullif(d->>'andou_pts','')::numeric),
    nullif(d->>'andou_pts_total','')::numeric, nullif(d->>'decorrido_s','')::numeric,
    coalesce(nullif(d->>'sinal_em','')::timestamptz,
             CASE WHEN d ? 'decorrido_s' THEN NEW.created_at - (d->>'decorrido_s')::numeric * interval '1 second' END),
    nullif(d->>'confirmou_em','')::timestamptz, nullif(d->>'preco_confirmacao','')::numeric,
    nullif(d->>'simulation_order_id','')::uuid, d->'degraus', d)
  ON CONFLICT (log_id) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL; -- medição nunca derruba a gravação do log do motor
END $f$;

DROP TRIGGER IF EXISTS b3_confirmacao_hist_trg ON b3_entry_decision_log;
CREATE TRIGGER b3_confirmacao_hist_trg AFTER INSERT ON b3_entry_decision_log
FOR EACH ROW WHEN (NEW.estagio IN ('confirmacao_atingida','confirmacao_nao_atingida','confirmacao_atingida_sem_entrada'))
EXECUTE FUNCTION b3_confirmacao_hist_copiar();

-- Carga inicial com o que ainda está no log (o resto já foi apagado).
INSERT INTO b3_confirmacao_hist (log_id, user_id, criado_em, trade_date, symbol, simulation_run_id, simulation_mode_id,
  mode, entry_style, estagio, lado, side, preco_sinal, exigido_pts, stop_pts, gain_pts, janela_s,
  andou_pts_janela, andou_pts_total, decorrido_s, sinal_em, confirmou_em, preco_confirmacao, simulation_order_id, degraus, detalhe)
SELECT l.id, l.user_id, l.created_at, l.trade_date, l.symbol, l.simulation_run_id, l.simulation_mode_id, l.mode, l.entry_style, l.estagio,
  l.detalhe->>'lado', l.detalhe->>'side',
  nullif(l.detalhe->>'preco_sinal','')::numeric, nullif(l.detalhe->>'exigido_pts','')::numeric,
  nullif(l.detalhe->>'stop_pts','')::numeric, nullif(l.detalhe->>'gain_pts','')::numeric, nullif(l.detalhe->>'janela_s','')::numeric::int,
  coalesce(nullif(l.detalhe->>'andou_pts_na_janela','')::numeric, nullif(l.detalhe->>'andou_pts','')::numeric),
  nullif(l.detalhe->>'andou_pts_total','')::numeric, nullif(l.detalhe->>'decorrido_s','')::numeric,
  coalesce(nullif(l.detalhe->>'sinal_em','')::timestamptz,
           CASE WHEN l.detalhe ? 'decorrido_s' THEN l.created_at - (l.detalhe->>'decorrido_s')::numeric * interval '1 second' END),
  nullif(l.detalhe->>'confirmou_em','')::timestamptz, nullif(l.detalhe->>'preco_confirmacao','')::numeric,
  nullif(l.detalhe->>'simulation_order_id','')::uuid, l.detalhe->'degraus', l.detalhe
FROM b3_entry_decision_log l
WHERE l.estagio IN ('confirmacao_atingida','confirmacao_nao_atingida','confirmacao_atingida_sem_entrada')
ON CONFLICT (log_id) DO NOTHING;
