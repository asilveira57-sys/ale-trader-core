CREATE INDEX IF NOT EXISTS idx_b3_sim_orders_user_entry_time ON public.b3_simulation_orders (user_id, entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_b3_sim_orders_run_user_status_exit ON public.b3_simulation_orders (simulation_run_id, user_id, status, exit_time DESC);
ANALYZE public.b3_simulation_orders;