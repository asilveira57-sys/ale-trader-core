ALTER FUNCTION public.b3_prd_auth_registra_mudanca() SET search_path = public;

DO $$
DECLARE t text; p text;
BEGIN
  FOR t, p IN SELECT * FROM (VALUES
    ('b3_ficha_do_dia','b3_ficha_do_dia_autenticado'),
    ('b3_calibracao_proposta','b3_calibracao_proposta_autenticado'),
    ('b3_pausa_estado','b3_pausa_estado_autenticado'),
    ('b3_manual_sistema','b3_manual_sistema_autenticado'),
    ('b3_runs_experimentais','b3_runs_experimentais_autenticado'),
    ('b3_livro_mudancas','b3_livro_mudancas_autenticado'),
    ('b3_pregoes_qualidade','b3_pregoes_qualidade_autenticado'),
    ('b3_vigia_tique','b3_vigia_tique_autenticado'),
    ('b3_regime_dia','b3_regime_dia_autenticado'),
    ('b3_calibracao_semanal','b3_calibracao_semanal_autenticado'),
    ('b3_paridade_modalidades','b3_paridade_modalidades_autenticado'),
    ('b3_variant_apelidos','b3_variant_apelidos_autenticado')
  ) v(t,p) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner())', p || '_dono', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Autenticados leem apelidos de modo" ON public.b3_mode_apelidos;
CREATE POLICY "Dono le apelidos de modo" ON public.b3_mode_apelidos FOR SELECT TO authenticated USING (public.is_owner());