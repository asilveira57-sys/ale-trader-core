GRANT SELECT ON public.b3_diagnostico_dia TO authenticated;
GRANT ALL ON public.b3_diagnostico_dia TO service_role;
ALTER TABLE public.b3_diagnostico_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner reads b3_diagnostico_dia" ON public.b3_diagnostico_dia;
CREATE POLICY "owner reads b3_diagnostico_dia" ON public.b3_diagnostico_dia FOR SELECT TO authenticated USING (public.is_owner());