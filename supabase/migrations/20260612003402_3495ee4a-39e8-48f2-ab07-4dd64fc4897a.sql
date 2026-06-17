
-- Vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Expert categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.expert_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  description text
);
GRANT SELECT ON public.expert_categories TO authenticated;
GRANT ALL ON public.expert_categories TO service_role;
ALTER TABLE public.expert_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads categories" ON public.expert_categories FOR SELECT TO authenticated USING (public.is_owner());

INSERT INTO public.expert_categories (slug, label) VALUES
  ('value', 'Value Investing'),
  ('swing', 'Swing Trade'),
  ('day', 'Day Trade'),
  ('position', 'Position Trade'),
  ('crypto', 'Cripto'),
  ('price_action', 'Price Action'),
  ('quant', 'Quantitativo'),
  ('macro', 'Macroeconômico'),
  ('fundamental', 'Fundamentalista'),
  ('tecnico', 'Técnico')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- Experts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES public.expert_categories(id) ON DELETE SET NULL,
  photo_url text,
  bio text,
  risk_profile text NOT NULL DEFAULT 'moderado' CHECK (risk_profile IN ('conservador','moderado','agressivo')),
  main_strategy text,
  sources_summary text,
  active boolean NOT NULL DEFAULT true,
  agent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.experts TO authenticated;
GRANT ALL ON public.experts TO service_role;
ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages experts" ON public.experts FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER experts_touch_updated BEFORE UPDATE ON public.experts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- Expert sources (youtube / pdf / text)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.expert_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('youtube','pdf','text')),
  url text,
  title text,
  storage_path text,
  raw_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','error')),
  error_msg text,
  tokens integer DEFAULT 0,
  chunk_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_sources TO authenticated;
GRANT ALL ON public.expert_sources TO service_role;
ALTER TABLE public.expert_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages expert_sources" ON public.expert_sources FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX IF NOT EXISTS expert_sources_expert_idx ON public.expert_sources(expert_id, created_at DESC);

-- ============================================================================
-- Expert chunks (vector store)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.expert_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.expert_sources(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_chunks TO authenticated;
GRANT ALL ON public.expert_chunks TO service_role;
ALTER TABLE public.expert_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages expert_chunks" ON public.expert_chunks FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX IF NOT EXISTS expert_chunks_expert_idx ON public.expert_chunks(expert_id);
CREATE INDEX IF NOT EXISTS expert_chunks_embedding_idx ON public.expert_chunks USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- Expert strategy (extracted by AI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.expert_strategy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL UNIQUE REFERENCES public.experts(id) ON DELETE CASCADE,
  philosophy text,
  buy_criteria text,
  sell_criteria text,
  risk_criteria text,
  confirmation_criteria text,
  exclusion_criteria text,
  catchphrases jsonb DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_strategy TO authenticated;
GRANT ALL ON public.expert_strategy TO service_role;
ALTER TABLE public.expert_strategy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages expert_strategy" ON public.expert_strategy FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER expert_strategy_touch BEFORE UPDATE ON public.expert_strategy FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- Extend agents + agent_votes
-- ============================================================================
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'rule' CHECK (kind IN ('rule','expert'));
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS expert_id uuid REFERENCES public.experts(id) ON DELETE SET NULL;
ALTER TABLE public.agent_votes ADD COLUMN IF NOT EXISTS knowledge_refs jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.experts
  ADD CONSTRAINT experts_agent_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

-- ============================================================================
-- Reputation + evolution log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_reputation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 50,
  hits integer NOT NULL DEFAULT 0,
  misses integer NOT NULL DEFAULT 0,
  profit_simulated numeric NOT NULL DEFAULT 0,
  max_drawdown numeric NOT NULL DEFAULT 0,
  consistency numeric NOT NULL DEFAULT 0,
  risk_reward numeric NOT NULL DEFAULT 0,
  weight_current numeric NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_reputation TO authenticated;
GRANT ALL ON public.agent_reputation TO service_role;
ALTER TABLE public.agent_reputation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages agent_reputation" ON public.agent_reputation FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER agent_reputation_touch BEFORE UPDATE ON public.agent_reputation FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.agent_evolution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.committee_decisions(id) ON DELETE SET NULL,
  vote text,
  outcome text CHECK (outcome IN ('win','loss','neutral','open')),
  pnl numeric,
  reputation_delta numeric,
  weight_before numeric,
  weight_after numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_evolution_log TO authenticated;
GRANT ALL ON public.agent_evolution_log TO service_role;
ALTER TABLE public.agent_evolution_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages evolution" ON public.agent_evolution_log FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE INDEX IF NOT EXISTS evolution_agent_idx ON public.agent_evolution_log(agent_id, created_at DESC);

-- ============================================================================
-- Committee debates
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.committee_debates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL UNIQUE REFERENCES public.committee_decisions(id) ON DELETE CASCADE,
  summary text,
  transcript jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.committee_debates TO authenticated;
GRANT ALL ON public.committee_debates TO service_role;
ALTER TABLE public.committee_debates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages debates" ON public.committee_debates FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- ============================================================================
-- Vector similarity search function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.match_expert_chunks(
  p_expert_id uuid,
  p_query_embedding vector(1536),
  p_match_count integer DEFAULT 5
)
RETURNS TABLE (id uuid, content text, metadata jsonb, similarity float)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.content, c.metadata, 1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM public.expert_chunks c
  WHERE c.expert_id = p_expert_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
GRANT EXECUTE ON FUNCTION public.match_expert_chunks(uuid, vector, integer) TO authenticated, service_role;
