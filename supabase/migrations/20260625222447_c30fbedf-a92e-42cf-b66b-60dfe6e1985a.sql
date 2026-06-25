create table if not exists public.b3_simulation_block_events (
  id uuid primary key default gen_random_uuid(),
  simulation_run_id uuid not null references public.b3_simulation_runs(id) on delete cascade,
  simulation_mode_id uuid references public.b3_simulation_modes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  occurred_at timestamptz not null default now(),
  prev_status text,
  new_status text not null,
  trigger text not null,
  observed_value numeric,
  limit_value numeric,
  pnl_at_moment numeric,
  related_order_id uuid,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_b3_block_events_run on public.b3_simulation_block_events (simulation_run_id, occurred_at desc);
create index if not exists idx_b3_block_events_mode on public.b3_simulation_block_events (simulation_mode_id, occurred_at desc);

grant select, insert, update, delete on public.b3_simulation_block_events to authenticated;
grant all on public.b3_simulation_block_events to service_role;

alter table public.b3_simulation_block_events enable row level security;

drop policy if exists "own b3_block_events" on public.b3_simulation_block_events;
create policy "own b3_block_events" on public.b3_simulation_block_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.b3_simulation_modes
  add column if not exists current_status text not null default 'operando',
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz default now(),
  add column if not exists last_trigger text;