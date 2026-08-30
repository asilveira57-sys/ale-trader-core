GRANT SELECT ON public.b3_mode_apelidos TO authenticated;
GRANT ALL ON public.b3_mode_apelidos TO service_role;
ALTER TABLE public.b3_mode_apelidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Autenticados leem apelidos de modo" ON public.b3_mode_apelidos;
CREATE POLICY "Autenticados leem apelidos de modo" ON public.b3_mode_apelidos FOR SELECT TO authenticated USING (true);