import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOwner(supabase: any) {
  const { data } = await supabase.from("user_roles").select("role").eq("role", "owner").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

const MODE = z.enum(["reading", "simulation", "testnet"]);

export const getLiveState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    const [{ data: session }, { data: settings }, { data: openPos }, { data: closedRecent }, { data: cb }, { data: assets }, { data: risk }] = await Promise.all([
      supabase.from("trading_sessions").select("*").in("status", ["running", "paused", "halted"]).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("live_simulated_positions").select("*").eq("status", "open").order("entry_time", { ascending: false }),
      supabase.from("live_simulated_positions").select("*").eq("status", "closed").order("exit_time", { ascending: false }).limit(20),
      supabase.from("circuit_breaker_events").select("*").is("closed_at", null).order("opened_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("monitored_assets").select("*").eq("active", true).order("pair"),
      supabase.from("risk_events").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    const { isTestnetConfigured } = await import("./binance-testnet.server");
    return {
      session, settings,
      open_positions: openPos ?? [],
      closed_recent: closedRecent ?? [],
      circuit_breaker: cb,
      assets: assets ?? [],
      risk_events: risk ?? [],
      testnet_ready: isTestnetConfigured(),
    };
  });

export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mode: MODE, initial_balance: z.number().min(100).max(1_000_000).default(10000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    // Stop any running session
    await supabase.from("trading_sessions").update({ status: "stopped", stopped_at: new Date().toISOString() }).in("status", ["running", "paused"]);
    if (data.mode === "testnet") {
      const { isTestnetConfigured } = await import("./binance-testnet.server");
      if (!isTestnetConfigured()) throw new Error("Configure BINANCE_TESTNET_API_KEY e BINANCE_TESTNET_API_SECRET antes de iniciar sessão testnet.");
    }
    const { data: row, error } = await supabase.from("trading_sessions").insert({
      mode: data.mode, status: "running",
      initial_balance: data.initial_balance, current_balance: data.initial_balance,
    }).select().single();
    if (error) throw new Error(error.message);
    await supabase.from("alerts").insert({
      type: "session_started", message: `▶️ Sessão ${data.mode} iniciada (saldo $${data.initial_balance})`, severity: "info",
    });
    return row;
  });

export const stopSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    await supabase.from("trading_sessions").update({ status: "stopped", stopped_at: new Date().toISOString() }).eq("id", data.session_id);
    return { ok: true };
  });

export const resumeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    // Close active circuit breaker
    await supabase.from("circuit_breaker_events").update({ closed_at: new Date().toISOString() }).eq("session_id", data.session_id).is("closed_at", null);
    await supabase.from("trading_sessions").update({ status: "running", reason: null }).eq("id", data.session_id);
    return { ok: true };
  });

export const tickNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ session_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    const { data: s } = await supabase.from("trading_sessions").select("*").eq("id", data.session_id).maybeSingle();
    if (!s) throw new Error("Sessão não encontrada");
    if (s.mode === "production") throw new Error("Modo produção bloqueado nesta fase");
    const { tickSession, recomputeReputation } = await import("./live.server");
    const res = await tickSession({ supabase, sessionId: data.session_id, mode: s.mode });
    if ((res as any).closed > 0) await recomputeReputation(supabase, data.session_id);
    return res;
  });

export const closePositionManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ position_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    const { data: pos } = await supabase.from("live_simulated_positions").select("*").eq("id", data.position_id).maybeSingle();
    if (!pos || pos.status !== "open") throw new Error("Posição inválida");
    const { getPublicTicker } = await import("./binance-testnet.server");
    const tk = await getPublicTicker(pos.pair);
    const price = tk?.price ?? Number(pos.last_price ?? pos.entry_price);
    const dir = pos.side === "buy" ? 1 : -1;
    const pnl = (price - Number(pos.entry_price)) * Number(pos.qty) * dir;
    const pnlPct = ((price - Number(pos.entry_price)) / Number(pos.entry_price)) * 100 * dir;
    await supabase.from("live_simulated_positions").update({
      status: "closed", exit_price: price, exit_time: new Date().toISOString(),
      exit_reason: "manual", pnl, pnl_pct: pnlPct, last_price: price,
    }).eq("id", data.position_id);
    if (pos.session_id) {
      const { data: s } = await supabase.from("trading_sessions").select("current_balance").eq("id", pos.session_id).maybeSingle();
      if (s) await supabase.from("trading_sessions").update({ current_balance: Number(s.current_balance) + pnl }).eq("id", pos.session_id);
    }
    return { ok: true, pnl };
  });

export const updateRiskSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    max_per_trade: z.number().min(0).optional(),
    max_per_asset: z.number().min(0).optional(),
    max_portfolio_exposure: z.number().min(0).optional(),
    daily_loss_limit: z.number().min(0).optional(),
    weekly_loss_limit: z.number().min(0).optional(),
    monthly_loss_limit: z.number().min(0).optional(),
    max_loss_streak: z.number().int().min(1).max(50).optional(),
    default_stop_pct: z.number().min(0.1).max(50).optional(),
    default_take_pct: z.number().min(0.1).max(100).optional(),
    mode: MODE.optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    await supabase.from("robot_settings").update(data).eq("id", 1);
    return { ok: true };
  });

export const getLiveMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    const { data: closed } = await supabase.from("live_simulated_positions").select("*").eq("status", "closed").order("exit_time", { ascending: true });
    const rows = closed ?? [];
    const n = rows.length;
    const wins = rows.filter((r: any) => Number(r.pnl) > 0).length;
    const losses = rows.filter((r: any) => Number(r.pnl) <= 0).length;
    const grossWin = rows.filter((r: any) => Number(r.pnl) > 0).reduce((s: number, r: any) => s + Number(r.pnl), 0);
    const grossLoss = Math.abs(rows.filter((r: any) => Number(r.pnl) < 0).reduce((s: number, r: any) => s + Number(r.pnl), 0));
    const totalPnl = rows.reduce((s: number, r: any) => s + Number(r.pnl), 0);
    let equity = 10000, peak = equity, maxDd = 0;
    const curve: { t: string; equity: number }[] = [];
    for (const r of rows) {
      equity += Number(r.pnl);
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
      curve.push({ t: String(r.exit_time).slice(0, 10), equity });
    }
    // Per-asset / per-agent
    const byAsset: Record<string, number> = {};
    for (const r of rows) byAsset[r.pair] = (byAsset[r.pair] ?? 0) + Number(r.pnl);
    const { data: reps } = await supabase.from("agents").select("id, name, weight").order("weight", { ascending: false });
    return {
      n_trades: n, n_wins: wins, n_losses: losses,
      win_rate: n ? (wins / n) * 100 : 0,
      profit_factor: grossLoss ? grossWin / grossLoss : 0,
      total_pnl: totalPnl,
      max_drawdown: maxDd,
      sharpe: 0, // simplified
      equity_curve: curve,
      by_asset: byAsset,
      agents: reps ?? [],
    };
  });

export const getReadinessCriteria = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    await assertOwner(supabase);
    const [{ data: sessions }, { data: closed }, { data: cb }, { data: settings }] = await Promise.all([
      supabase.from("trading_sessions").select("*").order("started_at", { ascending: true }),
      supabase.from("live_simulated_positions").select("pnl, exit_time").eq("status", "closed"),
      supabase.from("circuit_breaker_events").select("*"),
      supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    const oldest = sessions?.[0]?.started_at ? new Date(sessions[0].started_at) : null;
    const days = oldest ? Math.floor((Date.now() - oldest.getTime()) / (24 * 3600 * 1000)) : 0;
    const n = (closed ?? []).length;
    const grossWin = (closed ?? []).filter((r: any) => Number(r.pnl) > 0).reduce((s: number, r: any) => s + Number(r.pnl), 0);
    const grossLoss = Math.abs((closed ?? []).filter((r: any) => Number(r.pnl) < 0).reduce((s: number, r: any) => s + Number(r.pnl), 0));
    const pf = grossLoss ? grossWin / grossLoss : 0;
    let equity = 10000, peak = equity, maxDd = 0;
    for (const r of closed ?? []) { equity += Number(r.pnl); peak = Math.max(peak, equity); maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100); }
    const criteria = [
      { key: "days", label: "Operando ≥ 60 dias", value: `${days}d`, ok: days >= 60 },
      { key: "trades", label: "≥ 200 operações", value: String(n), ok: n >= 200 },
      { key: "pf", label: "Profit Factor ≥ 1.3", value: pf.toFixed(2), ok: pf >= 1.3 },
      { key: "dd", label: "Drawdown ≤ 20%", value: `${maxDd.toFixed(1)}%`, ok: maxDd <= 20 },
      { key: "cb", label: "Circuit breaker testado", value: String((cb ?? []).length), ok: (cb ?? []).length >= 1 },
    ];
    const ready = criteria.every((c) => c.ok);
    return { criteria, ready, phase_ready: !!settings?.phase_ready };
  });
