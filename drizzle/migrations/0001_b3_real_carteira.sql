CREATE TABLE public.b3_real_carteira (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  tipo text NOT NULL CHECK (tipo IN ('aporte','retirada','ajuste')),
  valor_brl numeric NOT NULL,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo = 'aporte' AND valor_brl > 0) OR (tipo = 'retirada' AND valor_brl < 0) OR tipo = 'ajuste')
);
GRANT SELECT, INSERT ON public.b3_real_carteira TO authenticated;
GRANT ALL ON public.b3_real_carteira TO service_role;
ALTER TABLE public.b3_real_carteira ENABLE ROW LEVEL SECURITY;
-- Livro: só leitura e inclusão. Sem UPDATE/DELETE — correção é por 'ajuste'.
CREATE POLICY "carteira le propria" ON public.b3_real_carteira FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "carteira lanca propria" ON public.b3_real_carteira FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX b3_real_carteira_user_idx ON public.b3_real_carteira(user_id, data);