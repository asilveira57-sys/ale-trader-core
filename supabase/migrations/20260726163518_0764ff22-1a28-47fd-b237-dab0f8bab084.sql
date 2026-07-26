
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.b3_mt5sim_manual_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL DEFAULT 'WINQ26',
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  volume INTEGER NOT NULL CHECK (volume > 0),
  price_entry NUMERIC NOT NULL,
  price_exit NUMERIC,
  points_result NUMERIC,
  gross_brl NUMERIC,
  fees_brl NUMERIC,
  net_brl NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  entry_reason TEXT DEFAULT 'manual',
  exit_reason TEXT,
  linked_trade_id UUID,
  ts_entry TIMESTAMPTZ NOT NULL DEFAULT now(),
  ts_exit TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX b3_mt5sim_manual_one_open_per_user
  ON public.b3_mt5sim_manual_trades(user_id) WHERE status = 'open';
CREATE INDEX b3_mt5sim_manual_user_ts ON public.b3_mt5sim_manual_trades(user_id, ts_entry DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b3_mt5sim_manual_trades TO authenticated;
GRANT ALL ON public.b3_mt5sim_manual_trades TO service_role;

ALTER TABLE public.b3_mt5sim_manual_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_desk_own" ON public.b3_mt5sim_manual_trades
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_b3_mt5sim_manual_trades_updated_at
  BEFORE UPDATE ON public.b3_mt5sim_manual_trades
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
