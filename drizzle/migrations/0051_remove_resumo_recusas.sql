-- 24/11/2026: remove o resumo diário de recusas criado na 0050.
-- Duplicava a exportação diária para o Google Drive (livreto 150).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'b3_resumo_recusas') THEN
    PERFORM cron.unschedule('b3_resumo_recusas');
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.b3_resumir_recusas_dia();
DROP TABLE IF EXISTS public.b3_recusas_resumo_dia;
