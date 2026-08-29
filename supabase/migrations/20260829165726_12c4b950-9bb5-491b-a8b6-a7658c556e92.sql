ALTER TABLE public.b3_mt5_account_state RENAME COLUMN balance TO saldo;
ALTER TABLE public.b3_mt5_account_state RENAME COLUMN equity TO capital_liquido;
ALTER TABLE public.b3_mt5_account_state RENAME COLUMN free_margin TO margem_livre;
ALTER TABLE public.b3_mt5_account_state RENAME COLUMN positions TO posicoes;
ALTER TABLE public.b3_mt5_account_state RENAME COLUMN reported_at TO reportado_em;
ALTER TABLE public.b3_mt5_account_state ADD COLUMN IF NOT EXISTS negociacao_permitida boolean;
ALTER TABLE public.b3_mt5_account_state ADD COLUMN IF NOT EXISTS env text;