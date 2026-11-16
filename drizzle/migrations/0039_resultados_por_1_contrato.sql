-- Todo resultado do cockpit por 1 CONTRATO (regra do dono, livreto 137; pedido 16/11/2026:
-- "se entrou com 10, 8, 7... dividir por ele mesmo e encontrar a razão unitária").
-- A view b3_ordens_1_contrato divide resultado, bruto, taxas e flutuante pela quantidade e
-- põe quantidade = 1. As leituras do cockpit (três leituras, disjuntor, picos, cinco pregões,
-- extrato do dia) passam a ler dela. O motor e a carteira continuam usando a tabela real.
CREATE OR REPLACE VIEW public.b3_ordens_1_contrato WITH (security_invoker = true) AS
SELECT o.id, o.simulation_run_id, o.simulation_mode_id, o.user_id, o.mode, o.symbol, o.contract_code, o.side, o.entry_price, o.exit_price, CASE WHEN o.quantity > 0 THEN 1 ELSE o.quantity END AS quantity, o.entry_time, o.exit_time, o.gross_result_points, round(o.gross_result_brl / nullif(o.quantity,0), 2) AS gross_result_brl, round(o.fees / nullif(o.quantity,0), 2) AS fees, round(o.net_result_brl / nullif(o.quantity,0), 2) AS net_result_brl, o.status, o.close_reason, o.created_at, o.updated_at, o.quote_source, o.quote_server, o.quote_symbol, o.quote_tick_ts, o.quote_bid, o.quote_ask, o.quote_last, o.execution_price, o.execution_price_origin, o.legacy_price_detected, o.provider_name, o.diagnostic_payload, o.last_eval_minute_ts, o.entry_score, o.entry_confidence, o.entry_approve_votes, o.entry_setup, o.stop_pts, o.gain_pts, o.unrealized_points, round(o.unrealized_brl / nullif(o.quantity,0), 2) AS unrealized_brl, o.mfe_pts, o.mae_pts, o.stop_price, o.target_price, o.stop_violado, o.stop_excedido_pts, o.bloqueado_na_sombra, o.nivel_freio_na_abertura, o.freios_na_sombra, o.confirmacao_exigida_pts, o.confirmacao_janela_s, o.confirmou, o.confirmou_em, o.preco_confirmacao, o.stop_recalculado, o.alvo_recalculado, o.geo_eficiencia_direcional, o.geo_posicao_na_faixa, o.geo_amplitude_pts, o.geo_velas, o.geo_veredito, o.agentes_votos, o.entrada_geometria
FROM public.b3_simulation_orders o;
COMMENT ON VIEW public.b3_ordens_1_contrato IS 'Ordens do simulado normalizadas para 1 contrato (regra do dono, livreto 137): resultado, bruto, taxas e flutuante divididos pela quantidade; quantidade = 1. Fonte de todas as leituras de resultado do cockpit desde 16/11/2026.';
REVOKE ALL ON public.b3_ordens_1_contrato FROM PUBLIC, anon;
GRANT SELECT ON public.b3_ordens_1_contrato TO authenticated, service_role;

-- As funções de leitura passam a ler a view (troca exata do nome da tabela nas definições
-- vigentes, que vêm das migrations 0029–0037).
DO $m$ DECLARE f record; d text; BEGIN
FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('b3_cockpit_tres_leituras','b3_cockpit_cinco_pregoes','b3_pico_realizado_dia','b3_pico_tres_cenarios_dia','b3_cockpit_disjuntor_niveis','b3_disjuntor_simulado','b3_extrato_dia_ordens') LOOP
  d := pg_get_functiondef(f.oid);
  IF position('b3_simulation_orders' in d) > 0 THEN
    d := replace(d, 'b3_simulation_orders', 'b3_ordens_1_contrato');
    EXECUTE d;
  END IF;
END LOOP; END $m$;
