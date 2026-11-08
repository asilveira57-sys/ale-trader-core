-- A defaulted fifth argument replaces the old callable signature; two overloads make four-argument trigger calls ambiguous.
DROP FUNCTION public.b3_carteira_aplicar(uuid,numeric,integer,text);
-- Preserve existing four-argument execution privileges on the single defaulted implementation.
GRANT EXECUTE ON FUNCTION public.b3_carteira_aplicar(uuid,numeric,integer,text,text) TO service_role;
