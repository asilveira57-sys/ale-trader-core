CREATE OR REPLACE FUNCTION public.b3_livro_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS b3_livro_ocorrencias_touch ON public.b3_livro_ocorrencias;
CREATE TRIGGER b3_livro_ocorrencias_touch BEFORE UPDATE ON public.b3_livro_ocorrencias FOR EACH ROW EXECUTE FUNCTION public.b3_livro_touch();