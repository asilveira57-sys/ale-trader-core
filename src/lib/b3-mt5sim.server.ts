// B3 Simulação Local MT5 XP — motor (server-only helpers).
// Isolado. Não importa nada de Binance nem do B3 clássico.
import type { SupabaseClient } from "@supabase/supabase-js";

export type SimSide = "buy" | "sell";
export const ROBOT_PROFILES = [
  "conservador",
  "moderado",
  "equilibrado",
  "semi_agressivo",
  "agressivo",
] as const;
export type RobotProfile = (typeof ROBOT_PROFILES)[number];

interface Settings {
  id: string;
  user_id: string;
  mt5_symbol: string;
  server: string;
  tick_size: number;
  tick_value_brl: number;
  point_value_brl: number;
  default_volume: number;
  price_source: "last" | "bid_ask" | "bid_ask_slip";
  slippage_ticks: number;
  fee_per_contract_brl: number;
  use_spread: boolean;
  quote_ttl_seconds: number;
  session_start: string;
  session_end: string;
  kill_switch_real: boolean;
  allow_long: boolean;
  allow_short: boolean;
  allow_reverse: boolean;
}

interface Robot {
  id: string;
  user_id: string;
  profile: RobotProfile;
  enabled: boolean;
  volume: number;
  initial_balance_brl: number;
  daily_loss_limit_brl: number;
  daily_gain_limit_brl: number;
  max_trades_day: number;
  max_drawdown_brl: number;
  max_consec_losses: number;
  min_score: number;
  signal_ttl_s: number;
  max_spread_ticks: number;
}

interface Quote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
  tick_ts: string;
  received_at: string;
}

// Parâmetros de estratégia por perfil (SMA rápido/lento + limiar)
const STRATEGY: Record<RobotProfile, { fast: number; slow: number; threshold: number; scoreBase: number }> = {
  conservador:    { fast: 20, slow: 80, threshold: 8, scoreBase: 70 },
  moderado:       { fast: 12, slow: 48, threshold: 6, scoreBase: 65 },
  equilibrado:    { fast: 9,  slow: 30, threshold: 5, scoreBase: 60 },
  semi_agressivo: { fast: 6,  slow: 18, threshold: 3, scoreBase: 55 },
  agressivo:      { fast: 3,  slow: 10, threshold: 2, scoreBase: 50 },
};

function priceForSide(q: Quote, s: Settings, side: SimSide): number | null {
  const src = s.price_source;
  const bid = q.bid ?? q.last;
  const ask = q.ask ?? q.last;
  if (src === "last") return q.last ?? null;
  const raw = side === "buy" ? ask : bid;
  if (raw == null) return null;
  if (src === "bid_ask_slip") {
    const slip = s.slippage_ticks * s.tick_size;
    return side === "buy" ? raw + slip : raw - slip;
  }
  return raw;
}

function pointsPnl(entry: number, exit: number, side: SimSide, tickSize: number): number {
  const raw = (exit - entry) * (side === "buy" ? 1 : -1);
  return Math.round(raw / tickSize) * tickSize;
}

function isInsideSession(nowUtc: Date, startBrt: string, endBrt: string): boolean {
  // BRT = UTC-3
  const brt = new Date(nowUtc.getTime() - 3 * 60 * 60 * 1000);
  const cur = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  const [sh, sm] = startBrt.split(":").map(Number);
  const [eh, em] = endBrt.split(":").map(Number);
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
}

async function ensureWallet(sb: SupabaseClient, userId: string, robot: Robot, date: string) {
  const { data } = await (sb as any)
    .from("b3_mt5sim_wallet_daily")
    .select("*")
    .eq("user_id", userId)
    .eq("robot_id", robot.id)
    .eq("session_date", date)
    .maybeSingle();
  if (data) return data as any;
  const { data: created, error } = await (sb as any)
    .from("b3_mt5sim_wallet_daily")
    .insert({
      user_id: userId,
      robot_id: robot.id,
      session_date: date,
      starting_balance_brl: robot.initial_balance_brl,
      current_balance_brl: robot.initial_balance_brl,
      peak_balance_brl: robot.initial_balance_brl,
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return created as any;
}

async function recentPrices(sb: SupabaseClient, userId: string, symbol: string, n: number): Promise<number[]> {
  const { data } = await (sb as any)
    .from("b3_mt5sim_quotes")
    .select("last, bid, ask, received_at")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .order("received_at", { ascending: false })
    .limit(n);
  const arr = ((data as any[]) ?? []).map((r) => Number(r.last ?? (r.bid && r.ask ? (r.bid + r.ask) / 2 : r.bid ?? r.ask))).filter((v) => Number.isFinite(v));
  return arr.reverse();
}

function sma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

async function generateSignal(sb: SupabaseClient, userId: string, robot: Robot, quote: Quote, symbol: string): Promise<{ side: SimSide; score: number; reason: string; price: number } | null> {
  const cfg = STRATEGY[robot.profile];
  const prices = await recentPrices(sb, userId, symbol, cfg.slow + 2);
  const f = sma(prices, cfg.fast);
  const s = sma(prices, cfg.slow);
  if (f == null || s == null) return null;
  const diff = f - s;
  if (Math.abs(diff) < cfg.threshold) return null;
  const side: SimSide = diff > 0 ? "buy" : "sell";
  const price = Number(quote.last ?? quote.bid ?? quote.ask);
  const score = Math.min(100, cfg.scoreBase + Math.min(30, Math.abs(diff)));
  return { side, score, reason: `SMA${cfg.fast}-SMA${cfg.slow}=${diff.toFixed(1)}`, price };
}

interface LockResult { allow: boolean; kind?: string; observed?: number; limit?: number; reason?: string }

function evaluateLocks(robot: Robot, wallet: any, quote: Quote, settings: Settings, score: number): LockResult {
  const spreadTicks = quote.spread != null ? quote.spread / settings.tick_size : 0;
  if (settings.use_spread && spreadTicks > robot.max_spread_ticks) return { allow: false, kind: "spread_alto", observed: spreadTicks, limit: robot.max_spread_ticks, reason: "spread acima do limite" };
  if (score < robot.min_score) return { allow: false, kind: "score_baixo", observed: score, limit: robot.min_score, reason: "score do sinal abaixo do mínimo" };
  if (Number(wallet.trades_count) >= robot.max_trades_day) return { allow: false, kind: "max_trades_dia", observed: wallet.trades_count, limit: robot.max_trades_day, reason: "máximo de operações diárias" };
  if (Number(wallet.pnl_net_brl) <= -Math.abs(robot.daily_loss_limit_brl)) return { allow: false, kind: "perda_diaria", observed: wallet.pnl_net_brl, limit: -Math.abs(robot.daily_loss_limit_brl), reason: "limite de perda diária" };
  if (Number(wallet.pnl_net_brl) >= robot.daily_gain_limit_brl) return { allow: false, kind: "ganho_diario", observed: wallet.pnl_net_brl, limit: robot.daily_gain_limit_brl, reason: "meta de ganho diário" };
  if (Number(wallet.drawdown_brl) >= robot.max_drawdown_brl) return { allow: false, kind: "drawdown_max", observed: wallet.drawdown_brl, limit: robot.max_drawdown_brl, reason: "drawdown máximo" };
  if (Number(wallet.consec_losses) >= robot.max_consec_losses) return { allow: false, kind: "perdas_consecutivas", observed: wallet.consec_losses, limit: robot.max_consec_losses, reason: "perdas consecutivas seguidas" };
  return { allow: true };
}

async function closeTrade(sb: SupabaseClient, userId: string, settings: Settings, robot: Robot, trade: any, quote: Quote, reason: string) {
  const side: SimSide = trade.side;
  const oppSide: SimSide = side === "buy" ? "sell" : "buy";
  const exitPx = priceForSide(quote, settings, oppSide);
  if (exitPx == null) return;
  const points = pointsPnl(Number(trade.price_entry_sim), exitPx, side, settings.tick_size);
  const gross = points * settings.point_value_brl * Number(trade.volume);
  const fee = settings.fee_per_contract_brl * Number(trade.volume) * 2;
  const net = gross - fee;
  await (sb as any)
    .from("b3_mt5sim_trades")
    .update({
      price_exit_sim: exitPx,
      ts_exit: new Date().toISOString(),
      points_result: points,
      gross_brl: gross,
      fee_brl: fee,
      net_brl: net,
      exit_reason: reason,
      status: "closed",
    })
    .eq("id", trade.id);

  // atualiza wallet
  const today = new Date().toISOString().slice(0, 10);
  const wallet = await ensureWallet(sb, userId, robot, today);
  const trades = Number(wallet.trades_count) + 1;
  const wins = Number(wallet.wins) + (net > 0 ? 1 : 0);
  const losses = Number(wallet.losses) + (net <= 0 ? 1 : 0);
  const pnlNet = Number(wallet.pnl_net_brl) + net;
  const pnlGross = Number(wallet.pnl_gross_brl) + gross;
  const fees = Number(wallet.fees_brl) + fee;
  const balance = Number(wallet.starting_balance_brl) + pnlNet;
  const peak = Math.max(Number(wallet.peak_balance_brl), balance);
  const drawdown = Math.max(Number(wallet.drawdown_brl), peak - balance);
  const consec = net <= 0 ? Number(wallet.consec_losses) + 1 : 0;
  await (sb as any)
    .from("b3_mt5sim_wallet_daily")
    .update({
      trades_count: trades,
      wins,
      losses,
      pnl_net_brl: pnlNet,
      pnl_gross_brl: pnlGross,
      fees_brl: fees,
      current_balance_brl: balance,
      peak_balance_brl: peak,
      drawdown_brl: drawdown,
      hit_rate: trades ? wins / trades : 0,
      best_trade_brl: Math.max(Number(wallet.best_trade_brl), net),
      worst_trade_brl: Math.min(Number(wallet.worst_trade_brl), net),
      points_net: Number(wallet.points_net) + points,
      consec_losses: consec,
      position_side: null,
      position_qty: null,
      position_avg_price: null,
    })
    .eq("id", wallet.id);
}

async function openTrade(sb: SupabaseClient, userId: string, settings: Settings, robot: Robot, signalId: string, side: SimSide, quote: Quote, priceSignal: number, reason: string) {
  const px = priceForSide(quote, settings, side);
  if (px == null) return null;
  const { data, error } = await (sb as any)
    .from("b3_mt5sim_trades")
    .insert({
      user_id: userId,
      robot_id: robot.id,
      signal_id: signalId,
      mt5_symbol: settings.mt5_symbol,
      side,
      volume: robot.volume,
      price_signal: priceSignal,
      price_entry_sim: px,
      ts_signal: quote.tick_ts,
      ts_entry: new Date().toISOString(),
      spread: quote.spread,
      slippage_ticks: settings.price_source === "bid_ask_slip" ? settings.slippage_ticks : 0,
      entry_reason: reason,
      status: "open",
    })
    .select()
    .single();
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  const wallet = await ensureWallet(sb, userId, robot, today);
  await (sb as any)
    .from("b3_mt5sim_wallet_daily")
    .update({ position_side: side, position_qty: robot.volume, position_avg_price: px, last_signal_at: new Date().toISOString() })
    .eq("id", wallet.id);
  return data;
}

export interface TickResult {
  status: string;
  signals: number;
  opened: number;
  closed: number;
  blocked: number;
  conflicts: number;
  quote_age_s?: number;
}

export async function runMt5SimTick(sb: SupabaseClient, userId: string, opts: { force?: boolean } = {}): Promise<TickResult> {
  const res: TickResult = { status: "ok", signals: 0, opened: 0, closed: 0, blocked: 0, conflicts: 0 };

  const { data: settings } = await (sb as any).from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!settings) return { ...res, status: "no_settings" };
  const s = settings as Settings;

  if (!opts.force && !isInsideSession(new Date(), s.session_start, s.session_end)) return { ...res, status: "fora_pregao" };

  const { data: quoteRow } = await (sb as any)
    .from("b3_mt5sim_quotes")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", s.mt5_symbol)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quoteRow) return { ...res, status: "sem_cotacao" };
  const q = quoteRow as Quote & { symbol: string };
  const age = (Date.now() - new Date(q.received_at).getTime()) / 1000;
  res.quote_age_s = age;
  if (age > s.quote_ttl_seconds) return { ...res, status: "cotacao_stale", quote_age_s: age };

  const { data: robots } = await (sb as any)
    .from("b3_mt5sim_robots")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  const list: Robot[] = (robots as any) ?? [];
  if (!list.length) return { ...res, status: "sem_robos" };

  const today = new Date().toISOString().slice(0, 10);
  const sidesActive: { robot: Robot; side: SimSide; price: number }[] = [];

  for (const robot of list) {
    const wallet = await ensureWallet(sb, userId, robot, today);

    // manage open position: close on opposite signal or on daily lock
    const { data: openTrades } = await (sb as any)
      .from("b3_mt5sim_trades")
      .select("*")
      .eq("user_id", userId)
      .eq("robot_id", robot.id)
      .eq("status", "open")
      .limit(1);
    const openT = ((openTrades as any[]) ?? [])[0];

    const sig = await generateSignal(sb, userId, robot, q, s.mt5_symbol);
    if (!sig) continue;
    res.signals++;

    // registrar sinal
    const { data: sigRow } = await (sb as any)
      .from("b3_mt5sim_signals")
      .insert({ user_id: userId, robot_id: robot.id, side: sig.side, price_signal: sig.price, score: sig.score, reason: sig.reason, expires_at: new Date(Date.now() + robot.signal_ttl_s * 1000).toISOString() })
      .select()
      .single();
    const signalId = (sigRow as any)?.id;

    // Se há posição aberta e o sinal é contrário → fecha e (se allow_reverse) abre.
    if (openT && openT.side !== sig.side) {
      await closeTrade(sb, userId, s, robot, openT, q, "sinal_contrario");
      res.closed++;
      if (!s.allow_reverse) continue;
    } else if (openT && openT.side === sig.side) {
      continue; // já posicionado no mesmo lado
    }

    // Trava
    const lock = evaluateLocks(robot, wallet, q, s, sig.score);
    if (!lock.allow) {
      await (sb as any).from("b3_mt5sim_blocks").insert({ user_id: userId, robot_id: robot.id, signal_id: signalId, lock_kind: lock.kind, observed: lock.observed, limit_value: lock.limit, reason: lock.reason });
      await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", signalId);
      await (sb as any).from("b3_mt5sim_wallet_daily").update({ blocks_count: Number(wallet.blocks_count) + 1, last_block_reason: lock.reason }).eq("id", wallet.id);
      res.blocked++;
      continue;
    }

    if ((sig.side === "buy" && !s.allow_long) || (sig.side === "sell" && !s.allow_short)) {
      await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", signalId);
      continue;
    }

    await openTrade(sb, userId, s, robot, signalId, sig.side, q, sig.price, sig.reason);
    await (sb as any).from("b3_mt5sim_signals").update({ status: "used" }).eq("id", signalId);
    res.opened++;
    sidesActive.push({ robot, side: sig.side, price: sig.price });
  }

  // Conflitos: robôs em lados opostos no mesmo tick
  const buys = sidesActive.filter((x) => x.side === "buy");
  const sells = sidesActive.filter((x) => x.side === "sell");
  if (buys.length && sells.length) {
    await (sb as any).from("b3_mt5sim_conflicts").insert({
      user_id: userId,
      robots: sidesActive.map((x) => ({ id: x.robot.id, profile: x.robot.profile })),
      sides: sidesActive.map((x) => x.side),
      prices: sidesActive.map((x) => x.price),
    });
    res.conflicts++;
  }

  return res;
}

// Guard exportado para uso futuro em rotas que enviariam ordem real.
export async function assertNoRealOrderIfSimActive(sb: SupabaseClient, userId: string, source: string, action: string, payload: unknown) {
  const { data: settings } = await (sb as any).from("b3_mt5sim_settings").select("kill_switch_real").eq("user_id", userId).maybeSingle();
  const { data: run } = await (sb as any).from("b3_mt5sim_runs").select("id").eq("user_id", userId).eq("status", "running").maybeSingle();
  if (settings?.kill_switch_real && run) {
    await (sb as any).from("b3_mt5sim_order_attempts").insert({ user_id: userId, source, action, payload: payload as any, blocked: true, message: "Tentativa de ordem real bloqueada — modo Simulação Local ativo" });
    throw new Error("Tentativa de ordem real bloqueada — modo Simulação Local ativo");
  }
}
