ALTER TABLE public.b3_live_orders DROP CONSTRAINT b3_live_orders_status_check;
ALTER TABLE public.b3_live_orders ADD CONSTRAINT b3_live_orders_status_check CHECK (status = ANY (ARRAY['open','closed','unknown_state','fechada_pela_corretora','divergente_corretora','irreconciliavel']));
ALTER TABLE public.b3_live_orders ADD COLUMN IF NOT EXISTS divergencias_leituras integer NOT NULL DEFAULT 0;
ALTER TABLE public.b3_mt5_account_state ADD COLUMN IF NOT EXISTS fechamentos jsonb;
UPDATE public.b3_live_orders SET status='irreconciliavel', updated_at=now()
 WHERE status='unknown_state' AND net_result_brl IS NULL AND exit_time < '2026-10-01';