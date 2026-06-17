ALTER TABLE public.agent_rankings
  ADD CONSTRAINT agent_rankings_agent_id_fkey
  FOREIGN KEY (agent_id)
  REFERENCES public.agents(id)
  ON DELETE CASCADE;