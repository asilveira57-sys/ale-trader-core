
-- Phase 8: Strategic Intelligence Center
create extension if not exists vector with schema extensions;

-- 1. Strategic Memory (semantic searchable)
create table public.strategic_memory (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- trade_executed | trade_rejected | audit | market_event | committee_debate | success_pattern | failure_pattern
  asset_id uuid null,
  ref_table text null,
  ref_id uuid null,
  title text null,
  content text not null,
  embedding extensions.vector(1536) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index strategic_memory_kind_idx on public.strategic_memory(kind);
create index strategic_memory_asset_idx on public.strategic_memory(asset_id);
create index strategic_memory_embedding_idx on public.strategic_memory using hnsw (embedding extensions.vector_cosine_ops);
grant select, insert, update, delete on public.strategic_memory to authenticated;
grant all on public.strategic_memory to service_role;
alter table public.strategic_memory enable row level security;
create policy "owner manages strategic_memory" on public.strategic_memory for all using (public.is_owner()) with check (public.is_owner());

-- 2. Market Regimes
create table public.market_regimes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid null,
  regime text not null, -- bull | bear | sideways | high_volatility | low_volatility
  confidence numeric not null default 0,
  volatility numeric null,
  trend_strength numeric null,
  metadata jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);
create index market_regimes_asset_idx on public.market_regimes(asset_id, detected_at desc);
grant select, insert, update, delete on public.market_regimes to authenticated;
grant all on public.market_regimes to service_role;
alter table public.market_regimes enable row level security;
create policy "owner manages market_regimes" on public.market_regimes for all using (public.is_owner()) with check (public.is_owner());

-- 3. Agent Rankings
create table public.agent_rankings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  period text not null, -- 30d | 90d | 180d | 365d
  score numeric not null default 0,
  accuracy numeric null,
  profit_contribution numeric null,
  drawdown_caused numeric null,
  consistency numeric null,
  veto_precision numeric null,
  justification_quality numeric null,
  trades_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique(agent_id, period)
);
create index agent_rankings_period_idx on public.agent_rankings(period, score desc);
grant select, insert, update, delete on public.agent_rankings to authenticated;
grant all on public.agent_rankings to service_role;
alter table public.agent_rankings enable row level security;
create policy "owner manages agent_rankings" on public.agent_rankings for all using (public.is_owner()) with check (public.is_owner());

-- 4. Learning Recommendations Queue (requires owner approval)
create table public.learning_recommendations (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- agent_weight | min_score | min_consensus | filter | other
  title text not null,
  description text not null,
  rationale text null,
  suggested_changes jsonb not null default '{}'::jsonb,
  expected_impact jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending', -- pending | approved | rejected | applied
  decided_by uuid null,
  decided_at timestamptz null,
  created_at timestamptz not null default now()
);
create index learning_recommendations_status_idx on public.learning_recommendations(status, created_at desc);
grant select, insert, update, delete on public.learning_recommendations to authenticated;
grant all on public.learning_recommendations to service_role;
alter table public.learning_recommendations enable row level security;
create policy "owner manages learning_recommendations" on public.learning_recommendations for all using (public.is_owner()) with check (public.is_owner());

-- 5. Strategy Laboratory
create table public.strategy_laboratory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  config jsonb not null default '{}'::jsonb, -- agents, weights, indicators, filters
  status text not null default 'draft', -- draft | running | completed | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.strategy_laboratory to authenticated;
grant all on public.strategy_laboratory to service_role;
alter table public.strategy_laboratory enable row level security;
create policy "owner manages strategy_laboratory" on public.strategy_laboratory for all using (public.is_owner()) with check (public.is_owner());
create trigger strategy_lab_touch before update on public.strategy_laboratory for each row execute function public.touch_updated_at();

-- 6. Strategy Simulations
create table public.strategy_simulations (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid null references public.strategy_laboratory(id) on delete cascade,
  params jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  expected_pnl numeric null,
  expected_drawdown numeric null,
  expected_winrate numeric null,
  score numeric null,
  notes text null,
  created_at timestamptz not null default now()
);
create index strategy_simulations_lab_idx on public.strategy_simulations(lab_id, created_at desc);
grant select, insert, update, delete on public.strategy_simulations to authenticated;
grant all on public.strategy_simulations to service_role;
alter table public.strategy_simulations enable row level security;
create policy "owner manages strategy_simulations" on public.strategy_simulations for all using (public.is_owner()) with check (public.is_owner());

-- 7. Opportunity Radar
create table public.opportunity_radar (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid null,
  symbol text null,
  kind text not null, -- promising | dangerous | emerging_trend | behavior_shift | regime_change
  score numeric not null default 0,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);
create index opportunity_radar_kind_idx on public.opportunity_radar(kind, created_at desc);
grant select, insert, update, delete on public.opportunity_radar to authenticated;
grant all on public.opportunity_radar to service_role;
alter table public.opportunity_radar enable row level security;
create policy "owner manages opportunity_radar" on public.opportunity_radar for all using (public.is_owner()) with check (public.is_owner());

-- 8. Seasonal Performance
create table public.seasonal_performance (
  id uuid primary key default gen_random_uuid(),
  period text not null, -- 30d | 90d | 180d | 365d
  metrics jsonb not null default '{}'::jsonb,
  trades_count integer not null default 0,
  net_pnl numeric null,
  win_rate numeric null,
  drawdown numeric null,
  profit_factor numeric null,
  computed_at timestamptz not null default now(),
  unique(period, computed_at)
);
create index seasonal_performance_period_idx on public.seasonal_performance(period, computed_at desc);
grant select, insert, update, delete on public.seasonal_performance to authenticated;
grant all on public.seasonal_performance to service_role;
alter table public.seasonal_performance enable row level security;
create policy "owner manages seasonal_performance" on public.seasonal_performance for all using (public.is_owner()) with check (public.is_owner());

-- 9. Intelligence Reports (post-trade, daily, weekly, monthly executive)
create table public.intelligence_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- post_trade | daily | weekly | monthly | comparison
  trade_ref text null, -- references automated/real/sim trade
  title text not null,
  summary text null,
  content text not null,
  technical_analysis text null,
  risk_analysis text null,
  agent_evaluation jsonb not null default '{}'::jsonb,
  recommendations text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index intelligence_reports_kind_idx on public.intelligence_reports(kind, created_at desc);
grant select, insert, update, delete on public.intelligence_reports to authenticated;
grant all on public.intelligence_reports to service_role;
alter table public.intelligence_reports enable row level security;
create policy "owner manages intelligence_reports" on public.intelligence_reports for all using (public.is_owner()) with check (public.is_owner());

-- 10. Knowledge Library
create table public.knowledge_library (
  id uuid primary key default gen_random_uuid(),
  source_type text not null, -- video | book | pdf | article | report
  title text not null,
  author text null,
  url text null,
  storage_path text null,
  classification jsonb not null default '{}'::jsonb, -- strategy, asset, market, risk
  content text null,
  embedding extensions.vector(1536) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index knowledge_library_type_idx on public.knowledge_library(source_type, created_at desc);
create index knowledge_library_embedding_idx on public.knowledge_library using hnsw (embedding extensions.vector_cosine_ops);
grant select, insert, update, delete on public.knowledge_library to authenticated;
grant all on public.knowledge_library to service_role;
alter table public.knowledge_library enable row level security;
create policy "owner manages knowledge_library" on public.knowledge_library for all using (public.is_owner()) with check (public.is_owner());

-- Semantic search function for strategic_memory (owner-only)
create or replace function public.match_strategic_memory(
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 10,
  p_kind text default null,
  p_asset_id uuid default null
)
returns table (id uuid, kind text, asset_id uuid, title text, content text, metadata jsonb, similarity double precision, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  return query
    select m.id, m.kind, m.asset_id, m.title, m.content, m.metadata,
           1 - (m.embedding <=> p_query_embedding) as similarity,
           m.created_at
    from public.strategic_memory m
    where m.embedding is not null
      and (p_kind is null or m.kind = p_kind)
      and (p_asset_id is null or m.asset_id = p_asset_id)
    order by m.embedding <=> p_query_embedding
    limit p_match_count;
end;
$$;
