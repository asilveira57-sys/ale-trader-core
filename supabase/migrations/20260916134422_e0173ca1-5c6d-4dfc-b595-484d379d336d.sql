ALTER TABLE public.b3_mt5_commands ADD COLUMN IF NOT EXISTS liberacao_manual boolean NOT NULL DEFAULT false;
ALTER TABLE public.b3_live_orders ADD COLUMN IF NOT EXISTS liberacao_manual boolean NOT NULL DEFAULT false;
ALTER TABLE public.b3_mt5_commands DROP CONSTRAINT IF EXISTS b3_mt5_commands_requested_by_check;
ALTER TABLE public.b3_mt5_commands ADD CONSTRAINT b3_mt5_commands_requested_by_check CHECK (requested_by = ANY (ARRAY['engine_auto'::text, 'engine_auto_liberado'::text, 'user_manual_close'::text, 'user_close_all'::text]));