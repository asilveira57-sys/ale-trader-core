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

// Limites globais de idade de tick (regra da fase).
export const TICK_ENTRY_MAX_AGE_S = 5;
export const TICK_PAUSE_AGE_S = 30;

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
  // Fase 1
  min_risk_reward: number;
  max_tick_age_seconds: number;
  max_tick_jump_pts: number;
  slippage_ticks_entry: number;
  slippage_ticks_exit: number;
}

interface Robot {
  id: string;
  user_id: string;
  profile: RobotProfile;
  enabled: boolean;
  mode: "manual" | "auto" | "paused";
  cooldown_s: number;
  cooldown_until: string | null;
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
  stop_loss_points: number;
  take_profit_points: number;
  // Fase 2 — gestão de saída configurável
  exit_mode: "fixed" | "breakeven" | "trailing" | "loss_of_momentum" | "time_based" | "session_close";
  breakeven_trigger_pts: number;
  trailing_start_pts: number;
  trailing_step_pts: number;
  max_duration_s: number;
}


interface Quote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
  tick_ts: string;
  received_at: string;
  server?: string | null;
}

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
    const slipTicks = (s.slippage_ticks_entry ?? s.slippage_ticks) || 0;
    const slip = slipTicks * s.tick_size;
    return side === "buy" ? raw + slip : raw - slip;
  }
  return raw;
}

function pointsPnl(entry: number, exit: number, side: SimSide, tickSize: number): number {
  const raw = (exit - entry) * (side === "buy" ? 1 : -1);
  return Math.round(raw / tickSize) * tickSize;
}

function isInsideSession(nowUtc: Date, startBrt: string, endBrt: string): boolean {
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
  const arr = ((data as any[]) ?? [])
    .map((r) => Number(r.last ?? (r.bid && r.ask ? (r.bid + r.ask) / 2 : r.bid ?? r.ask)))
    .filter((v) => Number.isFinite(v));
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

interface LockResult { allow: boolean; kind?: string; observed?: number; limit?: number; reason?: string; extra?: any }

function evaluateDailyLocks(robot: Robot, wallet: any): LockResult {
  if (Number(wallet.trades_count) >= robot.max_trades_day) return { allow: false, kind: "max_trades_dia", observed: wallet.trades_count, limit: robot.max_trades_day, reason: "máximo de operações diárias atingido" };
  if (Number(wallet.pnl_net_brl) <= -Math.abs(robot.daily_loss_limit_brl)) return { allow: false, kind: "perda_diaria", observed: wallet.pnl_net_brl, limit: -Math.abs(robot.daily_loss_limit_brl), reason: "limite de perda diária atingido" };
  if (Number(wallet.pnl_net_brl) >= robot.daily_gain_limit_brl) return { allow: false, kind: "ganho_diario", observed: wallet.pnl_net_brl, limit: robot.daily_gain_limit_brl, reason: "meta de ganho diário atingida" };
  if (Number(wallet.drawdown_brl) >= robot.max_drawdown_brl) return { allow: false, kind: "drawdown_max", observed: wallet.drawdown_brl, limit: robot.max_drawdown_brl, reason: "drawdown máximo excedido" };
  if (Number(wallet.consec_losses) >= robot.max_consec_losses) return { allow: false, kind: "perdas_consecutivas", observed: wallet.consec_losses, limit: robot.max_consec_losses, reason: "perdas consecutivas seguidas" };
  return { allow: true };
}

function evaluateEntryLocks(robot: Robot, wallet: any, quote: Quote, settings: Settings, score: number, quoteAgeS: number): LockResult {
  const maxAge = settings.max_tick_age_seconds ?? TICK_ENTRY_MAX_AGE_S;
  if (quoteAgeS > maxAge) return { allow: false, kind: "tick_desatualizado", observed: quoteAgeS, limit: maxAge, reason: `tick com ${quoteAgeS.toFixed(1)}s > ${maxAge}s` };
  const spreadTicks = quote.spread != null ? quote.spread / settings.tick_size : 0;
  if (settings.use_spread && spreadTicks > robot.max_spread_ticks) return { allow: false, kind: "spread_alto", observed: spreadTicks, limit: robot.max_spread_ticks, reason: "spread acima do limite" };
  if (score < robot.min_score) return { allow: false, kind: "score_baixo", observed: score, limit: robot.min_score, reason: "score do sinal abaixo do mínimo" };
  const daily = evaluateDailyLocks(robot, wallet);
  if (!daily.allow) return daily;
  return { allow: true };
}

/** Cálculo de risco/retorno considerando custos. */
function evaluateRiskReward(robot: Robot, settings: Settings, quote: Quote): { ok: boolean; rr: number; risk_net: number; reward_net: number } {
  const stopPts = Math.max(0, robot.stop_loss_points);
  const tpPts = Math.max(0, robot.take_profit_points);
  const pointValue = Number(settings.point_value_brl) || 0;
  const vol = Math.max(1, robot.volume);
  const fee = Number(settings.fee_per_contract_brl) * vol * 2;
  const spreadPts = quote.spread != null ? Number(quote.spread) : 0;
  const slipEntry = (settings.slippage_ticks_entry ?? 0) * settings.tick_size;
  const slipExit = (settings.slippage_ticks_exit ?? 0) * settings.tick_size;
  const cost = fee + (spreadPts + slipEntry + slipExit) * pointValue * vol;
  const risk = stopPts * pointValue * vol + cost;
  const reward = tpPts * pointValue * vol - cost;
  const rr = risk > 0 ? reward / risk : 0;
  return { ok: reward > 0 && rr >= (settings.min_risk_reward ?? 1.2), rr, risk_net: risk, reward_net: reward };
}

/** Fechamento canônico. Atualiza carteira e devolve o resultado. */
export async function closeSimTrade(
  sb: SupabaseClient,
  userId: string,
  settings: Settings,
  robot: Robot,
  trade: any,
  quote: Quote | null,
  reason: string,
  explicitExitPx?: number,
) {
  // Guarda de isolamento: um robô jamais pode fechar posição de outro.
  if (String(trade.robot_id) !== String(robot.id) || String(trade.user_id) !== String(userId)) {
    throw new Error(`isolamento violado: trade ${trade.id} não pertence ao robô ${robot.id}`);
  }
  if (trade.status !== "open") {
    throw new Error(`trade ${trade.id} não está aberta (status=${trade.status})`);
  }
  const side: SimSide = trade.side;
  const oppSide: SimSide = side === "buy" ? "sell" : "buy";
  const exitPx =
    explicitExitPx != null
      ? explicitExitPx
      : quote
        ? priceForSide(quote, settings, oppSide)
        : null;
  if (exitPx == null) return null;

  const points = pointsPnl(Number(trade.price_entry_sim), exitPx, side, settings.tick_size);
  const gross = points * Number(settings.point_value_brl) * Number(trade.volume);
  const fee = Number(settings.fee_per_contract_brl) * Number(trade.volume) * 2;
  const net = gross - fee;
  const entryTs = trade.ts_entry ? new Date(trade.ts_entry).getTime() : Date.now();
  const nowTs = Date.now();
  const durationS = Math.max(0, Math.round((nowTs - entryTs) / 1000));
  const tickAgeExit = quote ? (nowTs - new Date(quote.received_at).getTime()) / 1000 : null;
  const spreadExitTicks = quote?.spread != null ? Number(quote.spread) / settings.tick_size : null;

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
      exit_reason_detail: reason,
      status: "closed",
      duration_s: durationS,
      tick_age_exit_s: tickAgeExit,
      spread_exit_ticks: spreadExitTicks,
    })
    .eq("id", trade.id)
    .eq("robot_id", robot.id)
    .eq("user_id", userId)
    .eq("status", "open");


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
  const cd = Math.max(0, Number((robot as any).cooldown_s ?? 30));
  await (sb as any)
    .from("b3_mt5sim_robots")
    .update({ cooldown_until: new Date(Date.now() + cd * 1000).toISOString() })
    .eq("id", robot.id);
  return { points, gross, fee, net };
}


export async function openSimTrade(sb: SupabaseClient, userId: string, settings: Settings, robot: Robot, signalId: string | null, side: SimSide, quote: Quote, priceSignal: number, reason: string) {
  const px = priceForSide(quote, settings, side);
  if (px == null) return null;
  const stopPx = side === "buy" ? px - robot.stop_loss_points : px + robot.stop_loss_points;
  const tgtPx = side === "buy" ? px + robot.take_profit_points : px - robot.take_profit_points;
  const rr = evaluateRiskReward(robot, settings, quote);
  const tickAgeEntry = (Date.now() - new Date(quote.received_at).getTime()) / 1000;
  const spreadEntryTicks = quote.spread != null ? Number(quote.spread) / settings.tick_size : null;
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
      stop_price: stopPx,
      target_price: tgtPx,
      ts_signal: quote.tick_ts,
      ts_entry: new Date().toISOString(),
      spread: quote.spread,
      slippage_ticks: settings.price_source === "bid_ask_slip" ? (settings.slippage_ticks_entry ?? settings.slippage_ticks) : 0,
      entry_reason: reason,
      status: "open",
      // telemetria fase 1
      best_price: px,
      worst_price: px,
      mfe_pts: 0,
      mae_pts: 0,
      mfe_brl: 0,
      mae_brl: 0,
      max_open_profit_brl: 0,
      initial_risk_brl: rr.risk_net,
      initial_target_brl: rr.reward_net,
      risk_reward_ratio: rr.rr,
      tick_age_entry_s: tickAgeEntry,
      spread_entry_ticks: spreadEntryTicks,
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

async function registerBlock(sb: SupabaseClient, userId: string, robotId: string, signalId: string | null, lock: LockResult) {
  await (sb as any).from("b3_mt5sim_blocks").insert({
    user_id: userId,
    robot_id: robotId,
    signal_id: signalId,
    lock_kind: lock.kind,
    observed: lock.observed,
    limit_value: lock.limit,
    reason: lock.reason,
  });
}

/** Atualiza MFE/MAE/best/worst para uma posição aberta. */
async function updateTradeTelemetry(sb: SupabaseClient, settings: Settings, trade: any, refPrice: number) {
  const side: SimSide = trade.side;
  const entry = Number(trade.price_entry_sim);
  const best = Number(trade.best_price ?? entry);
  const worst = Number(trade.worst_price ?? entry);
  const newBest = side === "buy" ? Math.max(best, refPrice) : Math.min(best, refPrice);
  const newWorst = side === "buy" ? Math.min(worst, refPrice) : Math.max(worst, refPrice);
  const mfePts = side === "buy" ? newBest - entry : entry - newBest;
  const maePts = side === "buy" ? entry - newWorst : newWorst - entry;
  const pv = Number(settings.point_value_brl) * Number(trade.volume);
  const mfeBrl = mfePts * pv;
  const maeBrl = maePts * pv;
  const openPnl = pointsPnl(entry, refPrice, side, settings.tick_size) * pv;
  const maxOpen = Math.max(Number(trade.max_open_profit_brl ?? 0), openPnl);
  await (sb as any)
    .from("b3_mt5sim_trades")
    .update({
      best_price: newBest,
      worst_price: newWorst,
      mfe_pts: mfePts,
      mae_pts: maePts,
      mfe_brl: mfeBrl,
      mae_brl: maeBrl,
      max_open_profit_brl: maxOpen,
    })
    .eq("id", trade.id);
}

/**
 * Fase 2 — Aplica gestão de saída configurável por robô. Retorna `true` se a posição
 * foi encerrada por essa gestão. Não altera saídas duras (stop/alvo/trava_diária).
 */
async function applyExitMode(
  sb: SupabaseClient,
  userId: string,
  settings: Settings,
  robot: Robot,
  trade: any,
  quote: Quote,
  refPrice: number,
): Promise<{ closed: boolean; reason?: string; exitPx?: number }> {
  const side: SimSide = trade.side;
  const entry = Number(trade.price_entry_sim);
  const tick = Number(settings.tick_size) || 5;
  const gainPts = side === "buy" ? refPrice - entry : entry - refPrice;
  const entryTs = trade.ts_entry ? new Date(trade.ts_entry).getTime() : Date.now();
  const ageS = Math.max(0, Math.round((Date.now() - entryTs) / 1000));
  const mode = robot.exit_mode ?? "fixed";

  // Fechamento por horário: fim do pregão
  if (mode === "session_close") {
    if (!isInsideSession(new Date(), settings.session_start, settings.session_end)) {
      return { closed: true, reason: "session_close" };
    }
  }

  // Fechamento por tempo máximo em posição
  if ((mode === "time_based" || robot.max_duration_s > 0) && robot.max_duration_s > 0 && ageS >= robot.max_duration_s) {
    return { closed: true, reason: "time_based" };
  }

  // Perda de momento: MFE regrediu mais que trailing_step_pts a partir do pico
  if (mode === "loss_of_momentum" && robot.trailing_step_pts > 0) {
    const bestPx = Number(trade.best_price ?? entry);
    const mfePts = side === "buy" ? bestPx - entry : entry - bestPx;
    if (mfePts >= (robot.trailing_start_pts || 0)) {
      const giveback = side === "buy" ? bestPx - refPrice : refPrice - bestPx;
      if (giveback >= robot.trailing_step_pts) {
        return { closed: true, reason: "loss_of_momentum", exitPx: refPrice };
      }
    }
  }

  // Break-even: quando ganho >= gatilho, sobe stop para o preço de entrada
  if ((mode === "breakeven" || mode === "trailing") && robot.breakeven_trigger_pts > 0 && !trade.breakeven_active) {
    if (gainPts >= robot.breakeven_trigger_pts) {
      const newStop = entry;
      const better = side === "buy"
        ? (trade.stop_price == null || newStop > Number(trade.stop_price))
        : (trade.stop_price == null || newStop < Number(trade.stop_price));
      if (better) {
        await (sb as any)
          .from("b3_mt5sim_trades")
          .update({ stop_price: newStop, breakeven_active: true })
          .eq("id", trade.id);
        trade.stop_price = newStop;
        trade.breakeven_active = true;
      }
    }
  }

  // Trailing stop: após atingir start, sobe stop a cada passo
  if (mode === "trailing" && robot.trailing_start_pts > 0 && robot.trailing_step_pts > 0) {
    if (gainPts >= robot.trailing_start_pts) {
      const trailFromRef = side === "buy" ? refPrice - robot.trailing_step_pts * tick : refPrice + robot.trailing_step_pts * tick;
      const prevTrail = trade.trailing_stop_price != null ? Number(trade.trailing_stop_price) : null;
      const better = side === "buy"
        ? (prevTrail == null || trailFromRef > prevTrail)
        : (prevTrail == null || trailFromRef < prevTrail);
      if (better) {
        const currentStop = trade.stop_price != null ? Number(trade.stop_price) : null;
        const stopBetter = side === "buy"
          ? (currentStop == null || trailFromRef > currentStop)
          : (currentStop == null || trailFromRef < currentStop);
        await (sb as any)
          .from("b3_mt5sim_trades")
          .update({
            trailing_stop_price: trailFromRef,
            ...(stopBetter ? { stop_price: trailFromRef } : {}),
          })
          .eq("id", trade.id);
        trade.trailing_stop_price = trailFromRef;
        if (stopBetter) trade.stop_price = trailFromRef;
      }
    }
  }

  return { closed: false };
}

/** Chave de deduplicação entre robôs para o mesmo tick/janela. */
function buildSignalHash(symbol: string, side: SimSide, price: number, tsMs: number): string {
  const bucket = Math.floor(tsMs / 60_000); // 1 minuto
  const priceBucket = Math.round(price / 5) * 5;
  return `${symbol}|${side}|${bucket}|${priceBucket}`;
}

export interface TickResult {
  status: string;
  signals: number;
  opened: number;
  closed: number;
  blocked: number;
  conflicts: number;
  quote_age_s?: number;
  gap_detected?: boolean;
  duplicates_blocked?: number;
}

export async function runMt5SimTick(sb: SupabaseClient, userId: string, opts: { force?: boolean } = {}): Promise<TickResult> {
  const res: TickResult = { status: "ok", signals: 0, opened: 0, closed: 0, blocked: 0, conflicts: 0, duplicates_blocked: 0 };

  const { data: settings } = await (sb as any).from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!settings) return { ...res, status: "no_settings" };
  const s = settings as Settings;

  const insideSession = isInsideSession(new Date(), s.session_start, s.session_end);
  if (!opts.force && !insideSession) {
    await forceCloseAllOpen(sb, userId, s, "fim_horario");
    return { ...res, status: "fora_pregao" };
  }

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

  // Gap: compara com último tick registrado na run ativa.
  const currentPrice = Number(q.last ?? q.bid ?? q.ask ?? 0);
  const { data: activeRun } = await (sb as any)
    .from("b3_mt5sim_runs")
    .select("id, last_tick_price, last_tick_at")
    .eq("user_id", userId)
    .eq("status", "running")
    .maybeSingle();
  let gapDetected = false;
  if (activeRun) {
    const prev = Number((activeRun as any).last_tick_price ?? 0);
    if (prev > 0 && Math.abs(currentPrice - prev) > (s.max_tick_jump_pts ?? 500)) {
      gapDetected = true;
      res.gap_detected = true;
      await (sb as any).from("b3_mt5sim_blocks").insert({
        user_id: userId,
        robot_id: null,
        signal_id: null,
        lock_kind: "gap_detectado",
        observed: Math.abs(currentPrice - prev),
        limit_value: s.max_tick_jump_pts ?? 500,
        reason: `gap de ${Math.abs(currentPrice - prev).toFixed(0)} pts detectado (prev=${prev} → ${currentPrice})`,
      });
    }
    await (sb as any).from("b3_mt5sim_runs").update({
      last_tick_at: new Date().toISOString(),
      last_tick_price: currentPrice,
    }).eq("id", (activeRun as any).id);
  }

  if (age > TICK_PAUSE_AGE_S) return { ...res, status: "paused_stale", quote_age_s: age };
  const maxAgeEntry = s.max_tick_age_seconds ?? TICK_ENTRY_MAX_AGE_S;
  const staleForEntry = age > s.quote_ttl_seconds || age > maxAgeEntry;

  const { data: robots } = await (sb as any)
    .from("b3_mt5sim_robots")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  const list: Robot[] = (robots as any) ?? [];
  if (!list.length) return { ...res, status: "sem_robos" };

  const today = new Date().toISOString().slice(0, 10);

  // ============= FASE A — Watchdog: gestão de posições abertas =============
  // Isolada em try/catch para não bloquear futura fase de entrada em caso de erro.
  for (const robot of list) {
    try {
      const { data: openTrades } = await (sb as any)
        .from("b3_mt5sim_trades")
        .select("*")
        .eq("user_id", userId)
        .eq("robot_id", robot.id)
        .eq("status", "open");
      for (const t of ((openTrades as any[]) ?? [])) {
        const side: SimSide = t.side;
        const ref = Number(q.last ?? (side === "buy" ? q.bid : q.ask) ?? q.bid ?? q.ask);
        if (!Number.isFinite(ref)) continue;

        // Telemetria contínua (MFE/MAE)
        try { await updateTradeTelemetry(sb, s, t, ref); } catch { /* isolado */ }

        // Fase 2 — gestão de saída configurável (breakeven/trailing/tempo/momento/session)
        try {
          const exitDecision = await applyExitMode(sb, userId, s, robot, t, q, ref);
          if (exitDecision.closed) {
            await closeSimTrade(sb, userId, s, robot, t, q, exitDecision.reason ?? "exit_mode", exitDecision.exitPx);
            res.closed++;
            continue;
          }
        } catch { /* isolado */ }


        // Stop
        if (t.stop_price != null) {
          const hit = side === "buy" ? ref <= Number(t.stop_price) : ref >= Number(t.stop_price);
          if (hit) {
            await closeSimTrade(sb, userId, s, robot, t, q, "stop", Number(t.stop_price));
            res.closed++;
            continue;
          }
        }
        // Alvo
        if (t.target_price != null) {
          const hit = side === "buy" ? ref >= Number(t.target_price) : ref <= Number(t.target_price);
          if (hit) {
            await closeSimTrade(sb, userId, s, robot, t, q, "alvo", Number(t.target_price));
            res.closed++;
            continue;
          }
        }
        // Trava diária → zera posição
        const wallet = await ensureWallet(sb, userId, robot, today);
        const daily = evaluateDailyLocks(robot, wallet);
        if (!daily.allow) {
          await closeSimTrade(sb, userId, s, robot, t, q, `trava_${daily.kind}`);
          res.closed++;
        }
      }
    } catch (err) {
      await (sb as any).from("b3_mt5sim_blocks").insert({
        user_id: userId, robot_id: robot.id, signal_id: null,
        lock_kind: "position_management_alert",
        reason: `falha na gestão de posições: ${(err as Error).message}`,
      });
    }
  }

  // Se gap: não abre novas entradas neste tick, mas já rodou gestão acima.
  if (gapDetected) return { ...res, status: "gap_detected", quote_age_s: age };

  // ============= FASE B — Geração e deduplicação de sinais =============
  interface Candidate {
    robot: Robot;
    wallet: any;
    sig: { side: SimSide; score: number; reason: string; price: number };
    signalId: string | null;
    hash: string;
  }
  const candidates: Candidate[] = [];

  for (const robot of list) {
    if ((robot.mode ?? "manual") !== "auto") continue;
    if (robot.cooldown_until && new Date(robot.cooldown_until).getTime() > Date.now()) continue;
    try {
      const wallet = await ensureWallet(sb, userId, robot, today);
      const sig = await generateSignal(sb, userId, robot, q, s.mt5_symbol);
      if (!sig) continue;
      res.signals++;
      const hash = buildSignalHash(s.mt5_symbol, sig.side, sig.price, Date.now());
      const { data: sigRow } = await (sb as any)
        .from("b3_mt5sim_signals")
        .insert({
          user_id: userId, robot_id: robot.id, side: sig.side, price_signal: sig.price,
          score: sig.score, reason: sig.reason, signal_hash: hash,
          expires_at: new Date(Date.now() + robot.signal_ttl_s * 1000).toISOString(),
        })
        .select()
        .single();
      candidates.push({ robot, wallet, sig, signalId: (sigRow as any)?.id ?? null, hash });
    } catch (err) {
      await (sb as any).from("b3_mt5sim_blocks").insert({
        user_id: userId, robot_id: robot.id, signal_id: null,
        lock_kind: "signal_generation_error",
        reason: (err as Error).message,
      });
    }
  }

  // Dedup: agrupa por hash, mantém o de maior score.
  const byHash = new Map<string, Candidate>();
  const losers: Candidate[] = [];
  for (const c of candidates) {
    const cur = byHash.get(c.hash);
    if (!cur) { byHash.set(c.hash, c); continue; }
    if (c.sig.score > cur.sig.score) {
      losers.push(cur);
      byHash.set(c.hash, c);
    } else {
      losers.push(c);
    }
  }
  for (const l of losers) {
    await registerBlock(sb, userId, l.robot.id, l.signalId, {
      allow: false, kind: "duplicate_signal", reason: `sinal duplicado com robô de maior score no mesmo tick`,
      extra: { hash: l.hash, score: l.sig.score },
    });
    await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", l.signalId);
    res.blocked++;
    res.duplicates_blocked = (res.duplicates_blocked ?? 0) + 1;
  }

  // ============= FASE C — Avaliação de entrada por candidato =============
  const sidesActive: { robot: Robot; side: SimSide; price: number }[] = [];
  for (const c of byHash.values()) {
    const { robot, wallet, sig, signalId } = c;

    // Sinal contrário à posição aberta → fecha (não conta como entrada bloqueada)
    const { data: openTrades } = await (sb as any)
      .from("b3_mt5sim_trades")
      .select("*")
      .eq("user_id", userId)
      .eq("robot_id", robot.id)
      .eq("status", "open")
      .limit(1);
    const openT = ((openTrades as any[]) ?? [])[0];
    if (openT && openT.side !== sig.side) {
      await closeSimTrade(sb, userId, s, robot, openT, q, "sinal_contrario");
      res.closed++;
      if (!s.allow_reverse) {
        await (sb as any).from("b3_mt5sim_signals").update({ status: "used" }).eq("id", signalId);
        continue;
      }
    } else if (openT && openT.side === sig.side) {
      await (sb as any).from("b3_mt5sim_signals").update({ status: "ignored" }).eq("id", signalId);
      continue;
    }

    if (staleForEntry) {
      const lock: LockResult = { allow: false, kind: "tick_desatualizado", observed: age, limit: maxAgeEntry, reason: `tick com ${age.toFixed(1)}s — bloqueio de entrada` };
      await registerBlock(sb, userId, robot.id, signalId, lock);
      await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", signalId);
      await (sb as any).from("b3_mt5sim_wallet_daily").update({ blocks_count: Number(wallet.blocks_count) + 1, last_block_reason: lock.reason }).eq("id", wallet.id);
      res.blocked++;
      continue;
    }

    const lock = evaluateEntryLocks(robot, wallet, q, s, sig.score, age);
    if (!lock.allow) {
      await registerBlock(sb, userId, robot.id, signalId, lock);
      await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", signalId);
      await (sb as any).from("b3_mt5sim_wallet_daily").update({ blocks_count: Number(wallet.blocks_count) + 1, last_block_reason: lock.reason }).eq("id", wallet.id);
      res.blocked++;
      continue;
    }

    // R:R gate (custos incluídos)
    const rr = evaluateRiskReward(robot, s, q);
    if (!rr.ok) {
      const rrLock: LockResult = {
        allow: false, kind: "risk_reward_below_threshold",
        observed: Number(rr.rr.toFixed(2)), limit: Number(s.min_risk_reward ?? 1.2),
        reason: `R:R líquido ${rr.rr.toFixed(2)} < ${(s.min_risk_reward ?? 1.2).toFixed(2)} (risco R$ ${rr.risk_net.toFixed(2)} / alvo R$ ${rr.reward_net.toFixed(2)})`,
      };
      await registerBlock(sb, userId, robot.id, signalId, rrLock);
      await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", signalId);
      await (sb as any).from("b3_mt5sim_wallet_daily").update({ blocks_count: Number(wallet.blocks_count) + 1, last_block_reason: rrLock.reason }).eq("id", wallet.id);
      res.blocked++;
      continue;
    }

    if ((sig.side === "buy" && !s.allow_long) || (sig.side === "sell" && !s.allow_short)) {
      await registerBlock(sb, userId, robot.id, signalId, { allow: false, kind: "lado_desabilitado", reason: `lado ${sig.side} desabilitado nas configurações` });
      await (sb as any).from("b3_mt5sim_signals").update({ status: "blocked" }).eq("id", signalId);
      res.blocked++;
      continue;
    }

    await openSimTrade(sb, userId, s, robot, signalId, sig.side, q, sig.price, sig.reason);
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

async function forceCloseAllOpen(sb: SupabaseClient, userId: string, s: Settings, reason: string) {
  const { data: openTrades } = await (sb as any)
    .from("b3_mt5sim_trades")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open");
  const list = ((openTrades as any[]) ?? []);
  if (!list.length) return;
  const { data: quoteRow } = await (sb as any)
    .from("b3_mt5sim_quotes")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", s.mt5_symbol)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  for (const t of list) {
    const { data: robot } = await (sb as any).from("b3_mt5sim_robots").select("*").eq("id", t.robot_id).maybeSingle();
    if (!robot) continue;
    await closeSimTrade(sb, userId, s, robot as Robot, t, quoteRow as any, reason);
  }
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

// ---------------- Controle manual simulado ----------------

async function loadContext(sb: SupabaseClient, userId: string, robotId: string) {
  const [{ data: settings }, { data: robot }] = await Promise.all([
    (sb as any).from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle(),
    (sb as any).from("b3_mt5sim_robots").select("*").eq("id", robotId).eq("user_id", userId).maybeSingle(),
  ]);
  if (!settings) throw new Error("configuração de simulação ausente");
  if (!robot) throw new Error("robô não encontrado");
  const { data: quote } = await (sb as any)
    .from("b3_mt5sim_quotes")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", (settings as Settings).mt5_symbol)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quote) throw new Error("sem cotação disponível");
  const age = (Date.now() - new Date((quote as any).received_at).getTime()) / 1000;
  return { settings: settings as Settings, robot: robot as Robot, quote: quote as Quote, age };
}

async function findOpenTrade(sb: SupabaseClient, userId: string, robotId: string) {
  const { data } = await (sb as any)
    .from("b3_mt5sim_trades")
    .select("*")
    .eq("user_id", userId)
    .eq("robot_id", robotId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  return data as any;
}

async function registerConflictOnManual(sb: SupabaseClient, userId: string, robot: Robot, side: SimSide, price: number) {
  const { data: others } = await (sb as any)
    .from("b3_mt5sim_wallet_daily")
    .select("robot_id, position_side, position_avg_price")
    .eq("user_id", userId)
    .eq("session_date", new Date().toISOString().slice(0, 10))
    .not("position_side", "is", null);
  const opposite = ((others as any[]) ?? []).filter((w) => w.robot_id !== robot.id && w.position_side && w.position_side !== side);
  if (!opposite.length) return;
  await (sb as any).from("b3_mt5sim_conflicts").insert({
    user_id: userId,
    robots: [{ id: robot.id, profile: robot.profile }, ...opposite.map((o) => ({ id: o.robot_id }))],
    sides: [side, ...opposite.map((o) => o.position_side)],
    prices: [price, ...opposite.map((o) => Number(o.position_avg_price))],
  });
}

export async function manualOpenSimTrade(
  sb: SupabaseClient,
  userId: string,
  robotId: string,
  side: SimSide,
) {
  const { settings, robot, quote, age } = await loadContext(sb, userId, robotId);
  if (age > TICK_PAUSE_AGE_S) throw new Error(`tick vencido (${age.toFixed(1)}s) — simulação pausada`);
  const existing = await findOpenTrade(sb, userId, robotId);
  if (existing) {
    if (existing.side === side) {
      throw new Error(side === "buy" ? "Robô já possui compra simulada aberta" : "Robô já possui venda simulada aberta");
    }
    if (!settings.allow_reverse) {
      throw new Error(existing.side === "buy" ? "Robô comprado — virada não permitida" : "Robô vendido — vire mão não permitido");
    }
    await closeSimTrade(sb, userId, settings, robot, existing, quote, "sinal_manual_contrario");
    const opened = await openSimTrade(sb, userId, settings, robot, null, side, quote, Number(quote.last ?? (side === "buy" ? quote.ask : quote.bid) ?? 0), side === "buy" ? "manual_reverse_to_buy" : "manual_reverse_to_sell");
    await registerConflictOnManual(sb, userId, robot, side, Number(quote.last ?? 0));
    return opened;
  }
  const opened = await openSimTrade(sb, userId, settings, robot, null, side, quote, Number(quote.last ?? (side === "buy" ? quote.ask : quote.bid) ?? 0), side === "buy" ? "manual_buy" : "manual_sell");
  await registerConflictOnManual(sb, userId, robot, side, Number(quote.last ?? 0));
  return opened;
}

export async function manualReverseSimTrade(sb: SupabaseClient, userId: string, robotId: string) {
  const { settings, robot, quote, age } = await loadContext(sb, userId, robotId);
  if (age > TICK_PAUSE_AGE_S) throw new Error(`tick vencido (${age.toFixed(1)}s) — simulação pausada`);
  const existing = await findOpenTrade(sb, userId, robotId);
  if (!existing) throw new Error("Robô sem posição aberta para virar mão");
  const newSide: SimSide = existing.side === "buy" ? "sell" : "buy";
  await closeSimTrade(sb, userId, settings, robot, existing, quote, "manual_reverse");
  const opened = await openSimTrade(sb, userId, settings, robot, null, newSide, quote, Number(quote.last ?? 0), newSide === "buy" ? "manual_reverse_to_buy" : "manual_reverse_to_sell");
  return opened;
}
