CREATE TABLE public.b3_entry_decision_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  simulation_run_id uuid,
  simulation_mode_id uuid,
  mode text NOT NULL,
  symbol text NOT NULL,
  entry_style text,
  trade_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  estagio text NOT NULL,
  motivo text,
  detalhe jsonb,
  score numeric,
  confidence numeric,
  approve_votes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_entry_decision_log TO authenticated;
GRANT ALL ON public.b3_entry_decision_log TO service_role;

ALTER TABLE public.b3_entry_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own entry decision log"
  ON public.b3_entry_decision_log FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_b3_entry_decision_log_lookup
  ON public.b3_entry_decision_log (user_id, trade_date, symbol, mode, created_at DESC);
CREATE INDEX idx_b3_entry_decision_log_created
  ON public.b3_entry_decision_log (created_at);

CREATE OR REPLACE FUNCTION public.b3_retencao_diaria(p_lote integer DEFAULT 5000, p_max_lotes integer DEFAULT 60)
 RETURNS TABLE(tabela text, apagadas bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_alvos text[][] := ARRAY[
    ['b3_simulation_block_events',    'occurred_at', '7'],
    ['b3_simulation_agent_votes',     'created_at',  '5'],
    ['b3_mt5sim_quotes',              'received_at', '5'],
    ['b3_simulation_market_snapshots','created_at',  '3'],
    ['b3_entry_decision_log',         'created_at',  '4']
  ];
  v_tab text; v_col text; v_dias integer;
  v_n bigint; v_total bigint; v_lotes integer;
BEGIN
  FOR i IN 1 .. array_length(v_alvos, 1) LOOP
    v_tab  := v_alvos[i][1];
    v_col  := v_alvos[i][2];
    v_dias := v_alvos[i][3]::integer;
    v_total := 0;
    v_lotes := 0;

    LOOP
      EXECUTE format(
        'DELETE FROM public.%I WHERE ctid IN (
           SELECT ctid FROM public.%I WHERE %I < now() - interval ''%s days'' LIMIT %s)',
        v_tab, v_tab, v_col, v_dias, p_lote
      );
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_total := v_total + v_n;
      v_lotes := v_lotes + 1;
      EXIT WHEN v_n = 0 OR v_lotes >= p_max_lotes;
    END LOOP;

    tabela := v_tab; apagadas := v_total;
    RETURN NEXT;
  END LOOP;
END;
$function$;