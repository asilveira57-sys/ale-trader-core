ALTER TABLE public.b3_mt5_account_state ADD COLUMN IF NOT EXISTS modo_conta text;
ALTER TABLE public.b3_mt5_commands ADD COLUMN IF NOT EXISTS broker_position_ticket text;