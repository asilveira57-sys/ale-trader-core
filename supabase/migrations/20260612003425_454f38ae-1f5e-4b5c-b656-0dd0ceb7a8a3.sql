
-- Move pgvector out of public schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- Recreate matcher with owner gate inside; reference vector via extensions
DROP FUNCTION IF EXISTS public.match_expert_chunks(uuid, extensions.vector, integer);
DROP FUNCTION IF EXISTS public.match_expert_chunks(uuid, vector, integer);

CREATE OR REPLACE FUNCTION public.match_expert_chunks(
  p_expert_id uuid,
  p_query_embedding extensions.vector,
  p_match_count integer DEFAULT 5
)
RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT c.id, c.content, c.metadata, 1 - (c.embedding <=> p_query_embedding) AS similarity
    FROM public.expert_chunks c
    WHERE c.expert_id = p_expert_id AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;

REVOKE ALL ON FUNCTION public.match_expert_chunks(uuid, extensions.vector, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_expert_chunks(uuid, extensions.vector, integer) TO authenticated, service_role;
