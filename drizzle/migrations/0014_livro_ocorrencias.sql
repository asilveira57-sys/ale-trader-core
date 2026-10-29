CREATE TABLE public.b3_livro_ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  data date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('achado','retratacao','mudanca_aplicada','pedido_lovable','decisao','pendencia','fechamento_do_dia')),
  titulo text NOT NULL,
  corpo text NOT NULL,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','confirmado','suspeito','retratado','resolvido')),
  retrata_id uuid NULL REFERENCES public.b3_livro_ocorrencias(id),
  referencias jsonb NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX b3_livro_ocorrencias_user_data ON public.b3_livro_ocorrencias (user_id, data DESC);
CREATE INDEX b3_livro_ocorrencias_user_tipo ON public.b3_livro_ocorrencias (user_id, tipo);
GRANT SELECT, INSERT, UPDATE ON public.b3_livro_ocorrencias TO authenticated;
GRANT ALL ON public.b3_livro_ocorrencias TO service_role;
ALTER TABLE public.b3_livro_ocorrencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dono le o livro" ON public.b3_livro_ocorrencias FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "dono escreve no livro" ON public.b3_livro_ocorrencias FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dono edita o livro" ON public.b3_livro_ocorrencias FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER b3_livro_ocorrencias_touch BEFORE UPDATE ON public.b3_livro_ocorrencias FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
COMMENT ON TABLE public.b3_livro_ocorrencias IS 'Livro escrito à mão. Sem DELETE por desenho: errado é marcado retratado.';