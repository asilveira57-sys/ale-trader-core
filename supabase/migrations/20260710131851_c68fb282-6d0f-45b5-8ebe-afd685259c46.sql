ALTER TABLE public.b3_simulation_orders
  ADD COLUMN IF NOT EXISTS quote_source text NOT NULL DEFAULT 'desconhecida',
  ADD COLUMN IF NOT EXISTS quote_server text,
  ADD COLUMN IF NOT EXISTS quote_symbol text,
  ADD COLUMN IF NOT EXISTS quote_tick_ts timestamptz,
  ADD COLUMN IF NOT EXISTS quote_bid numeric,
  ADD COLUMN IF NOT EXISTS quote_ask numeric,
  ADD COLUMN IF NOT EXISTS quote_last numeric,
  ADD COLUMN IF NOT EXISTS execution_price numeric,
  ADD COLUMN IF NOT EXISTS execution_price_origin text,
  ADD COLUMN IF NOT EXISTS legacy_price_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT 'desconhecido';

ALTER TABLE public.b3_simulation_market_snapshots
  ADD COLUMN IF NOT EXISTS quote_source text NOT NULL DEFAULT 'desconhecida',
  ADD COLUMN IF NOT EXISTS quote_server text,
  ADD COLUMN IF NOT EXISTS quote_symbol text,
  ADD COLUMN IF NOT EXISTS quote_tick_ts timestamptz,
  ADD COLUMN IF NOT EXISTS quote_bid numeric,
  ADD COLUMN IF NOT EXISTS quote_ask numeric,
  ADD COLUMN IF NOT EXISTS quote_last numeric,
  ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT 'desconhecido';

ALTER TABLE public.b3_simulation_block_events
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS price_source text,
  ADD COLUMN IF NOT EXISTS rejected_price numeric,
  ADD COLUMN IF NOT EXISTS mt5_last numeric,
  ADD COLUMN IF NOT EXISTS diagnostic_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.b3_orders
  ADD COLUMN IF NOT EXISTS quote_source text NOT NULL DEFAULT 'CSV legado',
  ADD COLUMN IF NOT EXISTS quote_server text,
  ADD COLUMN IF NOT EXISTS quote_symbol text,
  ADD COLUMN IF NOT EXISTS quote_tick_ts timestamptz,
  ADD COLUMN IF NOT EXISTS quote_bid numeric,
  ADD COLUMN IF NOT EXISTS quote_ask numeric,
  ADD COLUMN IF NOT EXISTS quote_last numeric,
  ADD COLUMN IF NOT EXISTS execution_price numeric,
  ADD COLUMN IF NOT EXISTS execution_price_origin text,
  ADD COLUMN IF NOT EXISTS legacy_price_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT 'B3QuoteProvider';