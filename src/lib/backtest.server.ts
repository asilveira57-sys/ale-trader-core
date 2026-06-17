// Server-only backtest engine. Pure deterministic functions.
import {
  runAllAgents,
  buildDecision,
  type MarketContext,
  type AgentVote,
  type CommitteeSettings,
  type CommitteeDecision,
} from "./committee.server";

export interface Candle {
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---- Indicators (computed from a window of closes/highs/lows) ------------

function sma(values: number[], period: number) {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - 100 / (1 + rs);
}

function macd(values: number[]) {
  const macdLine = ema(values, 12) - ema(values, 26);
  const signal = ema(values.slice(-9).concat(macdLine), 9);
  return { macd: macdLine, macd_signal: signal };
}

function bollinger(values: number[], period = 20, mult = 2) {
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  const sd = Math.sqrt(variance);
  return { bb_upper: mean + sd * mult, bb_lower: mean - sd * mult };
}

export function buildContextFromCandles(
  pair: string,
  timeframe: string,
  windowCandles: Candle[],
): MarketContext {
  const closes = windowCandles.map((c) => c.close);
  const highs = windowCandles.map((c) => c.high);
  const lows = windowCandles.map((c) => c.low);
  const vols = windowCandles.map((c) => c.volume);
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2] ?? price;
  const last24 = closes.slice(-24);
  const high24 = Math.max(...highs.slice(-24));
  const low24 = Math.min(...lows.slice(-24));
  const vol24 = vols.slice(-24).reduce((a, b) => a + b, 0);
  const avgVol = vols.slice(-100).reduce((a, b) => a + b, 0) / Math.min(vols.length, 100);
  const smaShort = sma(closes, 9);
  const smaLong = sma(closes, 30);
  const { macd: m, macd_signal: ms } = macd(closes);
  const { bb_upper, bb_lower } = bollinger(closes);
  const rsiVal = rsi(closes);
  const change24 = ((price - (last24[0] ?? price)) / (last24[0] ?? price)) * 100;
  const support = Math.min(...lows.slice(-50));
  const resistance = Math.max(...highs.slice(-50));
  const momentum = ((price - (closes[closes.length - 10] ?? price)) / (closes[closes.length - 10] ?? price)) * 100;
  const stdRecent = Math.sqrt(
    closes.slice(-20).reduce((s, v) => s + (v - smaShort) ** 2, 0) / Math.min(closes.length, 20),
  );
  const volatility = (stdRecent / price) * 100;
  return {
    pair,
    timeframe,
    price,
    prev_price: prev,
    change_24h_pct: change24,
    high_24h: high24,
    low_24h: low24,
    volume_24h: vol24,
    avg_volume: avgVol || 1,
    rsi: rsiVal,
    macd: m,
    macd_signal: ms,
    sma_short: smaShort,
    sma_long: smaLong,
    bb_upper,
    bb_lower,
    support,
    resistance,
    momentum,
    volatility_pct: volatility,
    data_quality: Math.min(100, windowCandles.length * 2),
  };
}

// ---- Engine --------------------------------------------------------------

export interface BacktestSettings {
  initial_balance: number;
  max_trade_value: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  fee_pct: number;
  slippage_pct: number;
  reinvest: boolean;
  consensus: CommitteeSettings;
  weights: Record<string, number>;
  active_agents: Record<string, boolean>;
  mode: "agent_solo" | "committee" | "strategy" | "comparative";
  solo_agent?: string;
}

export interface BacktestTrade {
  pair: string;
  timeframe: string;
  side: "buy" | "sell";
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  fee_paid: number;
  slippage_applied: number;
  exit_reason: "stop" | "take" | "signal" | "end";
  pnl: number;
  pnl_pct: number;
  hold_minutes: number;
}

export interface BacktestAgentVote {
  agent_name: string;
  pair: string;
  timeframe: string;
  candle_time: string;
  vote: string;
  confidence: number;
  perceived_risk: number;
  has_veto: boolean;
  weight_used: number;
  outcome?: "good" | "bad" | "neutral";
}

export interface BacktestResult {
  trades: BacktestTrade[];
  votes: BacktestAgentVote[];
  equity_curve: { t: string; equity: number }[];
  drawdown_curve: { t: string; dd: number }[];
  final_balance: number;
  total_candles_processed: number;
  decisions_summary: Record<string, number>;
}

interface OpenPos {
  pair: string;
  timeframe: string;
  side: "buy" | "sell";
  entry_time: string;
  entry_price: number;
  quantity: number;
  fee_paid: number;
  slippage_applied: number;
  stop: number;
  take: number;
  votes_at_entry: { agent_name: string; vote: string }[];
}

const WARMUP = 60;
const TF_MINUTES: Record<string, number> = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

export async function runBacktestEngine(
  perAssetCandles: { pair: string; asset_id: string; timeframe: string; candles: Candle[] }[],
  settings: BacktestSettings,
  onProgress?: (processed: number, total: number) => Promise<void> | void,
): Promise<BacktestResult> {
  const trades: BacktestTrade[] = [];
  const votes: BacktestAgentVote[] = [];
  const equity_curve: { t: string; equity: number }[] = [];
  const drawdown_curve: { t: string; dd: number }[] = [];
  const decisions_summary: Record<string, number> = {};

  let balance = settings.initial_balance;
  let peak = balance;
  const open: Record<string, OpenPos> = {};

  // Merge all candles into a single timeline keyed by time for proper sequencing
  type Event = { t: number; pair: string; asset_id: string; timeframe: string; idx: number; candles: Candle[] };
  const events: Event[] = [];
  for (const { pair, asset_id, timeframe, candles } of perAssetCandles) {
    for (let i = WARMUP; i < candles.length - 1; i++) {
      events.push({ t: new Date(candles[i].open_time).getTime(), pair, asset_id, timeframe, idx: i, candles });
    }
  }
  events.sort((a, b) => a.t - b.t);

  const total = events.length;
  let processed = 0;

  for (const ev of events) {
    const window = ev.candles.slice(0, ev.idx + 1);
    const current = ev.candles[ev.idx];
    const next = ev.candles[ev.idx + 1];
    const key = `${ev.pair}_${ev.timeframe}`;

    // 1) Check stop/take on open position using current candle's high/low
    if (open[key]) {
      const pos = open[key];
      let exitPx: number | null = null;
      let reason: "stop" | "take" | null = null;
      if (pos.side === "buy") {
        if (current.low <= pos.stop) { exitPx = pos.stop; reason = "stop"; }
        else if (current.high >= pos.take) { exitPx = pos.take; reason = "take"; }
      } else {
        if (current.high >= pos.stop) { exitPx = pos.stop; reason = "stop"; }
        else if (current.low <= pos.take) { exitPx = pos.take; reason = "take"; }
      }
      if (exitPx !== null && reason) {
        const slip = exitPx * (settings.slippage_pct / 100);
        const realPx = pos.side === "buy" ? exitPx - slip : exitPx + slip;
        const grossPnl = pos.side === "buy"
          ? (realPx - pos.entry_price) * pos.quantity
          : (pos.entry_price - realPx) * pos.quantity;
        const exitFee = realPx * pos.quantity * (settings.fee_pct / 100);
        const pnl = grossPnl - exitFee;
        balance += pnl + pos.entry_price * pos.quantity; // return capital + pnl
        const hold = Math.round((new Date(current.open_time).getTime() - new Date(pos.entry_time).getTime()) / 60000);
        const trade: BacktestTrade = {
          pair: pos.pair, timeframe: pos.timeframe, side: pos.side,
          entry_time: pos.entry_time, exit_time: current.open_time,
          entry_price: pos.entry_price, exit_price: realPx,
          quantity: pos.quantity, fee_paid: pos.fee_paid + exitFee,
          slippage_applied: pos.slippage_applied + slip,
          exit_reason: reason, pnl, pnl_pct: (pnl / (pos.entry_price * pos.quantity)) * 100,
          hold_minutes: hold,
        };
        trades.push(trade);
        // mark outcome on votes
        const good = pnl > 0;
        for (const v of pos.votes_at_entry) {
          const target = votes.find((vv) => vv.agent_name === v.agent_name && vv.candle_time === pos.entry_time && vv.pair === pos.pair);
          if (target) target.outcome = good ? (v.vote === pos.side ? "good" : "bad") : (v.vote === pos.side ? "bad" : "good");
        }
        delete open[key];
      }
    }

    // 2) Build context & run agents
    const ctx = buildContextFromCandles(ev.pair, ev.timeframe, window);
    const agentVotes: AgentVote[] = runAllAgents(ctx, {
      weights: settings.weights,
      active: settings.active_agents,
      maxPositionValue: settings.max_trade_value,
      walletBalance: balance,
    });

    let decision: CommitteeDecision;
    if (settings.mode === "agent_solo" && settings.solo_agent) {
      const solo = agentVotes.find((v) => v.agent === settings.solo_agent);
      const finalDec = solo?.vote === "buy" ? "buy_approved" : solo?.vote === "sell" ? "sell_approved" : (solo?.vote ?? "hold");
      decision = {
        final_decision: finalDec as any,
        classification: "Solo agent",
        score: solo?.confidence ?? 0,
        avg_confidence: solo?.confidence ?? 0,
        votes_buy: solo?.vote === "buy" ? 1 : 0,
        votes_sell: solo?.vote === "sell" ? 1 : 0,
        votes_hold: solo?.vote === "hold" ? 1 : 0,
        votes_wait: solo?.vote === "wait" ? 1 : 0,
        risk_approved: !(solo?.has_veto),
        euphoria_vetoed: false,
        data_quality: ctx.data_quality,
        consolidated_justification: solo?.justification ?? "n/a",
      };
    } else {
      decision = buildDecision(agentVotes, settings.weights, settings.consensus, ctx.data_quality);
    }

    decisions_summary[decision.final_decision] = (decisions_summary[decision.final_decision] ?? 0) + 1;

    // record votes
    for (const v of agentVotes) {
      votes.push({
        agent_name: v.agent,
        pair: ev.pair,
        timeframe: ev.timeframe,
        candle_time: current.open_time,
        vote: v.vote,
        confidence: v.confidence,
        perceived_risk: v.perceived_risk,
        has_veto: v.has_veto,
        weight_used: settings.weights[v.agent] ?? 1,
      });
    }

    // 3) Apply decision — use NEXT candle open as execution price (no look-ahead)
    const execPx = next.open;

    if (!open[key]) {
      if (decision.final_decision === "buy_approved" || decision.final_decision === "sell_approved") {
        const side: "buy" | "sell" = decision.final_decision === "buy_approved" ? "buy" : "sell";
        const tradeValue = settings.reinvest
          ? Math.min(settings.max_trade_value, balance * 0.9)
          : Math.min(settings.max_trade_value, settings.initial_balance * 0.9);
        if (tradeValue > 10 && tradeValue <= balance) {
          const slip = execPx * (settings.slippage_pct / 100);
          const realPx = side === "buy" ? execPx + slip : execPx - slip;
          const fee = tradeValue * (settings.fee_pct / 100);
          const quantity = (tradeValue - fee) / realPx;
          balance -= tradeValue;
          open[key] = {
            pair: ev.pair, timeframe: ev.timeframe, side,
            entry_time: next.open_time,
            entry_price: realPx,
            quantity,
            fee_paid: fee,
            slippage_applied: slip,
            stop: side === "buy" ? realPx * (1 - settings.stop_loss_pct / 100) : realPx * (1 + settings.stop_loss_pct / 100),
            take: side === "buy" ? realPx * (1 + settings.take_profit_pct / 100) : realPx * (1 - settings.take_profit_pct / 100),
            votes_at_entry: agentVotes.map((v) => ({ agent_name: v.agent, vote: v.vote })),
          };
        }
      }
    } else {
      // Close on opposite signal
      const pos = open[key];
      const opposite = (pos.side === "buy" && decision.final_decision === "sell_approved")
        || (pos.side === "sell" && decision.final_decision === "buy_approved");
      if (opposite) {
        const slip = execPx * (settings.slippage_pct / 100);
        const realPx = pos.side === "buy" ? execPx - slip : execPx + slip;
        const exitFee = realPx * pos.quantity * (settings.fee_pct / 100);
        const grossPnl = pos.side === "buy"
          ? (realPx - pos.entry_price) * pos.quantity
          : (pos.entry_price - realPx) * pos.quantity;
        const pnl = grossPnl - exitFee;
        balance += pnl + pos.entry_price * pos.quantity;
        const hold = Math.round((new Date(next.open_time).getTime() - new Date(pos.entry_time).getTime()) / 60000);
        trades.push({
          pair: pos.pair, timeframe: pos.timeframe, side: pos.side,
          entry_time: pos.entry_time, exit_time: next.open_time,
          entry_price: pos.entry_price, exit_price: realPx,
          quantity: pos.quantity, fee_paid: pos.fee_paid + exitFee,
          slippage_applied: pos.slippage_applied + slip,
          exit_reason: "signal", pnl, pnl_pct: (pnl / (pos.entry_price * pos.quantity)) * 100,
          hold_minutes: hold,
        });
        delete open[key];
      }
    }

    // 4) Equity tracking (balance + open notional MTM)
    let equity = balance;
    for (const k of Object.keys(open)) {
      const p = open[k];
      const m = p.side === "buy" ? current.close * p.quantity : (2 * p.entry_price - current.close) * p.quantity;
      equity += m;
    }
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    equity_curve.push({ t: current.open_time, equity });
    drawdown_curve.push({ t: current.open_time, dd });

    processed++;
    if (onProgress && processed % 200 === 0) await onProgress(processed, total);
  }

  // Force-close any remaining open positions at last close
  for (const k of Object.keys(open)) {
    const pos = open[k];
    const last = perAssetCandles.find((a) => `${a.pair}_${a.timeframe}` === k)?.candles.slice(-1)[0];
    if (!last) continue;
    const exitPx = last.close;
    const exitFee = exitPx * pos.quantity * (settings.fee_pct / 100);
    const grossPnl = pos.side === "buy"
      ? (exitPx - pos.entry_price) * pos.quantity
      : (pos.entry_price - exitPx) * pos.quantity;
    const pnl = grossPnl - exitFee;
    balance += pnl + pos.entry_price * pos.quantity;
    trades.push({
      pair: pos.pair, timeframe: pos.timeframe, side: pos.side,
      entry_time: pos.entry_time, exit_time: last.open_time,
      entry_price: pos.entry_price, exit_price: exitPx,
      quantity: pos.quantity, fee_paid: pos.fee_paid + exitFee,
      slippage_applied: pos.slippage_applied,
      exit_reason: "end", pnl, pnl_pct: (pnl / (pos.entry_price * pos.quantity)) * 100,
      hold_minutes: Math.round((new Date(last.open_time).getTime() - new Date(pos.entry_time).getTime()) / 60000),
    });
  }

  return { trades, votes, equity_curve, drawdown_curve, final_balance: balance, total_candles_processed: processed, decisions_summary };
}

// ---- Metrics consolidation -----------------------------------------------

export function computeMetrics(result: BacktestResult, initialBalance: number) {
  const t = result.trades;
  const wins = t.filter((x) => x.pnl > 0);
  const losses = t.filter((x) => x.pnl <= 0);
  const totalPnl = t.reduce((s, x) => s + x.pnl, 0);
  const grossWin = wins.reduce((s, x) => s + x.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 999 : 0) : grossWin / grossLoss;
  const maxDD = Math.max(0, ...result.drawdown_curve.map((d) => d.dd));
  // streaks
  let maxWinStreak = 0, maxLossStreak = 0, cw = 0, cl = 0;
  for (const x of t) {
    if (x.pnl > 0) { cw++; cl = 0; maxWinStreak = Math.max(maxWinStreak, cw); }
    else { cl++; cw = 0; maxLossStreak = Math.max(maxLossStreak, cl); }
  }
  const breakdownByAsset: Record<string, number> = {};
  const breakdownByTf: Record<string, number> = {};
  for (const x of t) {
    breakdownByAsset[x.pair] = (breakdownByAsset[x.pair] ?? 0) + x.pnl;
    breakdownByTf[x.timeframe] = (breakdownByTf[x.timeframe] ?? 0) + x.pnl;
  }
  // breakdown by agent (from votes outcomes)
  const breakdownByAgent: Record<string, { good: number; bad: number; hit_rate: number }> = {};
  for (const v of result.votes) {
    if (!v.outcome || v.outcome === "neutral") continue;
    const a = (breakdownByAgent[v.agent_name] ??= { good: 0, bad: 0, hit_rate: 0 });
    if (v.outcome === "good") a.good++; else a.bad++;
  }
  for (const k of Object.keys(breakdownByAgent)) {
    const a = breakdownByAgent[k];
    const tot = a.good + a.bad;
    a.hit_rate = tot ? (a.good / tot) * 100 : 0;
  }

  return {
    total_pnl: totalPnl,
    return_pct: (totalPnl / initialBalance) * 100,
    win_rate: t.length ? (wins.length / t.length) * 100 : 0,
    n_trades: t.length,
    n_wins: wins.length,
    n_losses: losses.length,
    biggest_win: wins.reduce((m, x) => Math.max(m, x.pnl), 0),
    biggest_loss: losses.reduce((m, x) => Math.min(m, x.pnl), 0),
    max_drawdown: maxDD,
    max_drawdown_pct: maxDD,
    max_loss_streak: maxLossStreak,
    max_win_streak: maxWinStreak,
    profit_factor: profitFactor,
    avg_rr: wins.length && losses.length
      ? (grossWin / wins.length) / (grossLoss / losses.length)
      : 0,
    avg_hold_minutes: t.length ? t.reduce((s, x) => s + x.hold_minutes, 0) / t.length : 0,
    breakdown_by_asset: breakdownByAsset,
    breakdown_by_timeframe: breakdownByTf,
    breakdown_by_agent: breakdownByAgent,
    breakdown_by_decision: result.decisions_summary,
    final_balance: initialBalance + totalPnl,
  };
}

// ---- Binance public klines fetch -----------------------------------------

const BINANCE_TF: Record<string, string> = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };

export async function fetchBinanceKlines(pair: string, timeframe: string, days: number): Promise<Candle[]> {
  const tf = BINANCE_TF[timeframe];
  if (!tf) throw new Error(`Timeframe não suportado: ${timeframe}`);
  const ms = days * 24 * 60 * 60 * 1000;
  const endTime = Date.now();
  const startTime = endTime - ms;
  const tfMs = TF_MINUTES[timeframe] * 60_000;
  const out: Candle[] = [];
  let cursor = startTime;
  // Binance limit per call = 1000
  while (cursor < endTime) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", pair);
    url.searchParams.set("interval", tf);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    url.searchParams.set("limit", "1000");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const rows = (await res.json()) as any[];
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        open_time: new Date(r[0]).toISOString(),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
    }
    const last = rows[rows.length - 1][0] as number;
    if (last + tfMs <= cursor) break;
    cursor = last + tfMs;
    if (rows.length < 1000) break;
  }
  return out;
}
