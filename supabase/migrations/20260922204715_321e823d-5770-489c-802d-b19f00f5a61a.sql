
-- O agregado de decisões varre ~150 mil linhas de um pregão e estourava o
-- tempo limite padrão da API. Tempo próprio, só para estas leituras.
ALTER FUNCTION public.b3_export_csv_bloqueios(date, text) SET statement_timeout = '180s';
ALTER FUNCTION public.b3_export_csv_dossie_ordens(date) SET statement_timeout = '180s';
ALTER FUNCTION public.b3_export_csv_dossie_votos(date) SET statement_timeout = '180s';
ALTER FUNCTION public.b3_export_csv_decisoes(date) SET statement_timeout = '180s';
ALTER FUNCTION public.b3_export_dias(date) SET statement_timeout = '120s';
