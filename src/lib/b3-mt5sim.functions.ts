// Server functions do modo "Simulação Local MT5 XP" (WINQ26).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runMt5SimTick, ROBOT_PROFILES } from "./b3-mt5sim.server";

const DEFAULT_ROBOT_PARAMS: Record<string, { volume: number; daily_loss_limit_brl: number; daily_gain_limit_brl: number; max_trades_day: number; max_drawdown_brl: number; max_consec_losses: number; min_score: number }> = {
  conservador:    { volume: 1, daily_loss_limit_brl:  60, daily_gain_limit_brl: 180, max_trades_day:  8, max_drawdown_brl:  80, max_consec_losses: 3, min_score: 75 },
  moderado:       { volume: 1, daily_loss_limit_brl:  80, daily_gain_limit_brl: 240, max_trades_day: 12, max_drawdown_brl: 120, max_consec_losses: 3, min_score: 65 },
  equilibrado:    { volume: 1, daily_loss_limit_brl: 100, daily_gain_limit_brl: 300, max_trades_day: 16, max_drawdown_brl: 150, max_consec_losses: 4, min_score: 60 },
  semi_agressivo: { volume: 1, daily_loss_limit_brl: 140, daily_gain_limit_brl: 400, max_trades_day: 22, max_drawdown_brl: 200, max_consec_losses: 4, min_score: 55 },
  agressivo:      { volume: 1, daily_loss_limit_brl: 180, daily_gain_limit_brl: 500, max_trades_day: 30, max_drawdown_brl: 260, max_consec_losses: 5, min_score: 50 },
};

async function ensureSettingsAndRobots(sb: any, userId: string) {
  let { data: settings } = await sb.from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!settings) {
    const { data: created } = await sb.from("b3_mt5sim_settings").insert({ user_id: userId }).select().single();
    settings = created;
  }
  const { data: robots } = await sb.from("b3_mt5sim_robots").select("id, profile").eq("user_id", userId);
  const existing = new Set(((robots as any[]) ?? []).map((r) => r.profile));
  const toInsert = ROBOT_PROFILES.filter((p) => !existing.has(p)).map((p) => ({ user_id: userId, profile: p, ...DEFAULT_ROBOT_PARAMS[p] }));
  if (toInsert.length) await sb.from("b3_mt5sim_robots").insert(toInsert);
  return settings;
}

export const getMt5SimDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const settings = await ensureSettingsAndRobots(supabase, userId);
    const [{ data: robots }, { data: run }, { data: quote }, { data: wallets }, { data: trades }, { data: blocks }, { data: conflicts }, { data: attempts }] = await Promise.all([
      supabase.from("b3_mt5sim_robots").select("*").eq("user_id", userId).order("profile"),
      supabase.from("b3_mt5sim_runs").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("b3_mt5sim_quotes").select("*").eq("user_id", userId).eq("symbol", settings.mt5_symbol).order("received_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("b3_mt5sim_wallet_daily").select("*").eq("user_id", userId).eq("session_date", new Date().toISOString().slice(0, 10)),
      supabase.from("b3_mt5sim_trades").select("*").eq("user_id", userId).order("ts_entry", { ascending: false }).limit(50),
      supabase.from("b3_mt5sim_blocks").select("*").eq("user_id", userId).order("ts", { ascending: false }).limit(50),
      supabase.from("b3_mt5sim_conflicts").select("*").eq("user_id", userId).order("ts", { ascending: false }).limit(30),
      supabase.from("b3_mt5sim_order_attempts").select("*").eq("user_id", userId).order("ts", { ascending: false }).limit(20),
    ]);

    const quoteAgeSec = quote ? (Date.now() - new Date((quote as any).received_at).getTime()) / 1000 : null;

    // ranking do dia
    const ranking = (((wallets as any[]) ?? []).map((w) => {
      const r = ((robots as any[]) ?? []).find((x) => x.id === w.robot_id);
      const trades = Number(w.trades_count);
      const avgWin = trades ? Number(w.pnl_net_brl) / trades : 0;
      const composite = Number(w.pnl_net_brl) - Number(w.drawdown_brl) * 0.5 + Number(w.hit_rate) * 100;
      return { robot_id: w.robot_id, profile: r?.profile, pnl_net: Number(w.pnl_net_brl), hit_rate: Number(w.hit_rate), drawdown: Number(w.drawdown_brl), trades, avg_per_trade: avgWin, composite };
    })).sort((a, b) => b.composite - a.composite);

    // status de promoção
    const eligible = ranking.every((r) => r.trades >= settings.min_trades_per_robot && r.drawdown <= settings.max_drawdown_brl && r.hit_rate >= settings.min_hit_rate && r.pnl_net >= settings.min_net_pnl_brl);
    return {
      settings,
      run,
      quote,
      quote_age_s: quoteAgeSec,
      robots: robots ?? [],
      wallets: wallets ?? [],
      trades: trades ?? [],
      blocks: blocks ?? [],
      conflicts: conflicts ?? [],
      order_attempts: attempts ?? [],
      ranking,
      real_orders_sent: 0,
      promotion_ready: eligible && ranking.length > 0,
    };
  });

const settingsSchema = z.object({
  price_source: z.enum(["last", "bid_ask", "bid_ask_slip"]).optional(),
  slippage_ticks: z.number().optional(),
  fee_per_contract_brl: z.number().optional(),
  use_spread: z.boolean().optional(),
  quote_ttl_seconds: z.number().int().min(2).max(120).optional(),
  session_start: z.string().optional(),
  session_end: z.string().optional(),
  kill_switch_real: z.boolean().optional(),
  allow_long: z.boolean().optional(),
  allow_short: z.boolean().optional(),
  allow_reverse: z.boolean().optional(),
  default_volume: z.number().int().min(1).max(50).optional(),
  min_trades_per_robot: z.number().int().min(0).optional(),
  min_days: z.number().int().min(0).optional(),
  max_price_divergence_pts: z.number().min(0).optional(),
  max_drawdown_brl: z.number().min(0).optional(),
  min_hit_rate: z.number().min(0).max(1).optional(),
  min_net_pnl_brl: z.number().optional(),
});

export const updateMt5SimSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await ensureSettingsAndRobots(supabase, userId);
    const { error } = await supabase.from("b3_mt5sim_settings").update(data).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

const robotSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  mode: z.enum(["manual", "auto", "paused"]).optional(),
  cooldown_s: z.number().int().min(0).max(3600).optional(),
  volume: z.number().int().min(1).max(50).optional(),
  daily_loss_limit_brl: z.number().min(0).optional(),
  daily_gain_limit_brl: z.number().min(0).optional(),
  max_trades_day: z.number().int().min(1).max(500).optional(),
  max_drawdown_brl: z.number().min(0).optional(),
  max_consec_losses: z.number().int().min(1).max(50).optional(),
  min_score: z.number().min(0).max(100).optional(),
  signal_ttl_s: z.number().int().min(1).max(600).optional(),
  max_spread_ticks: z.number().min(0).optional(),
  initial_balance_brl: z.number().min(0).optional(),
  stop_loss_points: z.number().min(0).optional(),
  take_profit_points: z.number().min(0).optional(),
});


export const upsertMt5SimRobot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => robotSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { id, ...rest } = data;
    const { error } = await supabase.from("b3_mt5sim_robots").update(rest).eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const startMt5SimRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await ensureSettingsAndRobots(supabase, userId);
    // stop any active
    await supabase.from("b3_mt5sim_runs").update({ status: "stopped", stopped_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "running");
    const { data, error } = await supabase.from("b3_mt5sim_runs").insert({ user_id: userId, status: "running" }).select().single();
    if (error) throw error;
    return data;
  });

export const stopMt5SimRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await supabase.from("b3_mt5sim_runs").update({ status: "stopped", stopped_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "running");
    return { ok: true };
  });

export const tickMt5SimNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const res = await runMt5SimTick(supabase, userId, { force: true });
    return res;
  });

export const closeMt5SimTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ trade_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: t } = await supabase.from("b3_mt5sim_trades").select("*").eq("id", data.trade_id).eq("user_id", userId).maybeSingle();
    if (!t) throw new Error("trade não encontrada");
    if (t.status !== "open") throw new Error("trade já encerrada");
    const { data: settings } = await supabase.from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle();
    const { data: quote } = await supabase.from("b3_mt5sim_quotes").select("*").eq("user_id", userId).eq("symbol", settings.mt5_symbol).order("received_at", { ascending: false }).limit(1).maybeSingle();
    if (!quote) throw new Error("sem cotação");
    const { data: robot } = await supabase.from("b3_mt5sim_robots").select("*").eq("id", t.robot_id).eq("user_id", userId).maybeSingle();
    if (!robot) throw new Error("robô não encontrado");
    const { closeSimTrade } = await import("./b3-mt5sim.server");
    // Fechamento manual: compra fecha no Bid, venda fecha no Ask.
    const exitPx = t.side === "buy"
      ? Number(quote.bid ?? quote.last ?? quote.ask)
      : Number(quote.ask ?? quote.last ?? quote.bid);
    const result = await closeSimTrade(supabase, userId, settings, robot, t, quote, "manual", exitPx);

    return { ok: true, ...(result ?? {}) };
  });

export const manualBuyMt5Sim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ robot_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { manualOpenSimTrade } = await import("./b3-mt5sim.server");
    const t = await manualOpenSimTrade(supabase, userId, data.robot_id, "buy");
    return { ok: true, trade: t };
  });

export const manualSellMt5Sim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ robot_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { manualOpenSimTrade } = await import("./b3-mt5sim.server");
    const t = await manualOpenSimTrade(supabase, userId, data.robot_id, "sell");
    return { ok: true, trade: t };
  });

export const manualReverseMt5Sim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ robot_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { manualReverseSimTrade } = await import("./b3-mt5sim.server");
    const t = await manualReverseSimTrade(supabase, userId, data.robot_id);
    return { ok: true, trade: t };
  });

export const setMt5SimRobotMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ robot_id: z.string().uuid(), mode: z.enum(["manual", "auto", "paused"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase.from("b3_mt5sim_robots").update({ mode: data.mode }).eq("id", data.robot_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

