// Histórico completo da simulação 3 modos — leitura
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAllB3SimOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [runR, modesR, ordersR, settingsR] = await Promise.all([
      (supabase as any).from("b3_simulation_runs").select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId),
      (supabase as any).from("b3_simulation_orders").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: false }).limit(5000),
      (supabase as any).from("b3_trading_settings").select("price_source").eq("user_id", userId).maybeSingle(),
    ]);
    if (runR.error) throw runR.error;
    if (!runR.data) throw new Error("Run não encontrada");
    const isMt5 = settingsR.data?.price_source === "mt5_xp_demo";
    const allOrders = (ordersR.data ?? []) as any[];
    // Ordens abertas SEMPRE aparecem — filtro legado só esconde ordens já encerradas/canceladas
    // que não tenham auditoria MT5, para evitar reintroduzir preços antigos no histórico.
    const orders = isMt5
      ? allOrders.filter((o) =>
          o.status === "open"
            ? true
            : o.quote_source === "MT5 XP DEMO" && o.provider_name === "B3QuoteProvider",
        )
      : allOrders;
    return {
      run: runR.data,
      modes: modesR.data ?? [],
      orders,
      price_source: settingsR.data?.price_source ?? "csv",
      legacy_orders_hidden: isMt5 ? allOrders.length - orders.length : 0,
    };
  });


export const listB3SimVotesForOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Os votos são gravados no mesmo tick que abriu a ordem, dentro do mesmo modo.
    // Buscamos pelo simulation_mode_id próximo do created_at da ordem.
    const { data: o } = await (supabase as any).from("b3_simulation_orders")
      .select("simulation_run_id, simulation_mode_id, created_at")
      .eq("id", data.order_id).eq("user_id", userId).maybeSingle();
    if (!o) return [];
    const before = new Date(new Date(o.created_at).getTime() + 2000).toISOString();
    const after = new Date(new Date(o.created_at).getTime() - 60_000).toISOString();
    const { data: votes } = await (supabase as any).from("b3_simulation_agent_votes")
      .select("*")
      .eq("simulation_run_id", o.simulation_run_id)
      .eq("simulation_mode_id", o.simulation_mode_id)
      .eq("user_id", userId)
      .gte("created_at", after).lte("created_at", before)
      .order("created_at", { ascending: false });
    return votes ?? [];
  });

// Painel ao vivo — snapshots de mercado, ordens, modos e últimos votos
export const getB3SimLiveDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; hours?: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const hours = Math.max(1, Math.min(72, data.hours ?? 6));
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const [runR, modesR, ordersR, snapsR, votesR, settingsR] = await Promise.all([
      (supabase as any).from("b3_simulation_runs").select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId),
      (supabase as any).from("b3_simulation_orders").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: true }).limit(5000),
      (supabase as any).from("b3_simulation_market_snapshots").select("market_time, price, candle_open, candle_high, candle_low, candle_close, volume").eq("simulation_run_id", data.run_id).eq("user_id", userId).gte("market_time", since).order("market_time", { ascending: true }).limit(2000),
      (supabase as any).from("b3_simulation_agent_votes").select("created_at, mode, agent_name, vote, confidence, reason").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
      (supabase as any).from("b3_trading_settings").select("price_source").eq("user_id", userId).maybeSingle(),
    ]);
    if (runR.error) throw runR.error;
    if (!runR.data) throw new Error("Run não encontrada");
    const isMt5 = settingsR.data?.price_source === "mt5_xp_demo";
    const allOrders = (ordersR.data ?? []) as any[];
    // Ordens abertas SEMPRE são retornadas — o filtro legado só oculta ordens já
    // encerradas sem auditoria MT5, para não poluir o histórico com preços antigos.
    const orders = isMt5
      ? allOrders.filter((o) =>
          o.status === "open"
            ? true
            : o.quote_source === "MT5 XP DEMO" && o.provider_name === "B3QuoteProvider",
        )
      : allOrders;
    const snapshots = snapsR.data ?? [];
    const lastSnap = snapshots.length ? snapshots[snapshots.length - 1] : null;
    const lastPrice = lastSnap ? Number((lastSnap as any).price ?? (lastSnap as any).candle_close ?? 0) : null;
    const lastPriceAt = lastSnap ? (lastSnap as any).market_time : null;
    return {
      run: runR.data,
      modes: modesR.data ?? [],
      orders,
      snapshots,
      recent_votes: votesR.data ?? [],
      price_source: settingsR.data?.price_source ?? "csv",
      legacy_orders_hidden: isMt5 ? allOrders.length - orders.length : 0,
      last_price: lastPrice,
      last_price_at: lastPriceAt,
      point_value_brl: 0.2,
    };
  });

