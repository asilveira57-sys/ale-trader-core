// Live tick engine — runs committee on real-time data and manages paper positions.
// Production mode is HARD BLOCKED. Testnet is gated behind explicit keys.

import type { SupabaseClient } from "@supabase/supabase-js";

export type LiveMode = "reading" | "simulation" | "testnet";

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - 100 / (1 + rs);
}
function sma(arr: number[], n: number): number { const s = arr.slice(-n); return s.reduce((a, b) => a + b, 0) / Math.max(1, s.length); }
function macd(closes: number[]): { macd: number; signal: number } {
  function ema(arr: number[], n: number) { const k = 2 / (n + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; }
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  return { macd: e12 - e26, signal: ema(closes.slice(-9).map(() => e12 - e26), 9) };
}

export function buildContextFromCandles(pair: string, tf: string, candles: Array<{ o: number; h: number; l: number; c: number; v: number }>) {
  const closes = candles.map((c) => c.c);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const high = Math.max(...candles.slice(-24).map((c) => c.h));
  const low = Math.min(...candles.slice(-24).map((c) => c.l));
  const vols = candles.slice(-50).map((c) => c.v);
  const volAvg = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
  const sShort = sma(closes, 9), sLong = sma(closes, 26);
  const m = macd(closes);
  const r = rsi(closes);
  const bbMid = sma(closes, 20);
  const variance = closes.slice(-20).reduce((s, x) => s + (x - bbMid) ** 2, 0) / 20;
  const stdev = Math.sqrt(variance);
  const change24 = ((last.c - prev.c) / prev.c) * 100;
  return {
    pair, timeframe: tf,
    price: last.c, prev_price: prev.c,
    change_24h_pct: change24,
    high_24h: high, low_24h: low,
    volume_24h: last.v, avg_volume: volAvg,
    rsi: r, macd: m.macd, macd_signal: m.signal,
    sma_short: sShort, sma_long: sLong,
    bb_upper: bbMid + 2 * stdev, bb_lower: bbMid - 2 * stdev,
    support: low, resistance: high,
    momentum: change24 * 10,
    volatility_pct: (stdev / last.c) * 100,
    data_quality: candles.length >= 50 ? 95 : 60,
  };
}

interface TickParams {
  supabase: SupabaseClient;
  sessionId: string;
  mode: LiveMode;
}

export async function tickSession({ supabase, sessionId, mode }: TickParams) {
  const { getPublicTicker, getPublicKlines, isTestnetConfigured, placeTestnetOrder } = await import("./binance-testnet.server");
  const { runAllAgents, buildDecision } = await import("./committee.server");

  // 1. Load session + settings
  const [{ data: session }, { data: settings }, { data: comSettings }, { data: agents }, { data: assets }] = await Promise.all([
    supabase.from("trading_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase.from("robot_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("committee_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("agents").select("*").eq("active", true),
    supabase.from("monitored_assets").select("*").eq("active", true),
  ]);
  if (!session) throw new Error("Sessão não encontrada");
  if (session.status === "halted") return { skipped: true, reason: "halted" };
  if (session.status === "paused") return { skipped: true, reason: "paused" };

  // 2. Check circuit breaker
  const cb = await checkCircuitBreaker(supabase, sessionId, settings);
  if (cb.tripped) {
    await supabase.from("trading_sessions").update({ status: "halted", reason: cb.reason }).eq("id", sessionId);
    await supabase.from("circuit_breaker_events").insert({ session_id: sessionId, trigger: cb.trigger, message: cb.reason });
    await supabase.from("alerts").insert({ type: "circuit_breaker", message: `🛑 Circuit breaker: ${cb.reason}`, severity: "critical" });
    return { halted: true, reason: cb.reason };
  }

  // 3. Update open positions with fresh price + check stop/take
  const { data: openPositions } = await supabase
    .from("live_simulated_positions")
    .select("*")
    .eq("session_id", sessionId)
    .eq("status", "open");

  let closedCount = 0;
  for (const pos of openPositions ?? []) {
    const tk = await getPublicTicker(pos.pair);
    if (!tk) continue;
    const price = tk.price;
    const hit = pos.side === "buy"
      ? (price <= Number(pos.stop_loss) ? "stop" : price >= Number(pos.take_profit) ? "take" : null)
      : (price >= Number(pos.stop_loss) ? "stop" : price <= Number(pos.take_profit) ? "take" : null);
    if (hit) {
      const dir = pos.side === "buy" ? 1 : -1;
      const pnl = (price - Number(pos.entry_price)) * Number(pos.qty) * dir;
      const pnlPct = ((price - Number(pos.entry_price)) / Number(pos.entry_price)) * 100 * dir;
      await supabase.from("live_simulated_positions").update({
        status: "closed", exit_price: price, exit_time: new Date().toISOString(),
        exit_reason: hit, pnl, pnl_pct: pnlPct, last_price: price,
      }).eq("id", pos.id);
      await supabase.from("trading_sessions").update({ current_balance: Number(session.current_balance) + pnl }).eq("id", sessionId);
      await supabase.from("alerts").insert({
        type: hit === "take" ? "take_profit" : "stop_loss",
        pair: pos.pair, message: `${pos.pair}: ${hit === "take" ? "🎯 alvo" : "🛑 stop"} @ ${price.toFixed(2)} (PnL ${pnl.toFixed(2)})`,
        severity: hit === "take" ? "info" : "warning",
      });
      closedCount++;
      session.current_balance = Number(session.current_balance) + pnl;
    } else {
      await supabase.from("live_simulated_positions").update({ last_price: price }).eq("id", pos.id);
    }
  }

  if (mode === "reading") return { mode, closed: closedCount, opened: 0 };

  // 4. For each asset, run committee and possibly open new position
  const weights: Record<string, number> = {};
  const active: Record<string, boolean> = {};
  for (const a of agents ?? []) { weights[a.name] = Number(a.weight ?? 1); active[a.name] = true; }

  let openedCount = 0;
  for (const asset of assets ?? []) {
    // Skip if we already have an open position on this pair this session
    const already = (openPositions ?? []).some((p: any) => p.pair === asset.pair && p.status === "open");
    if (already) continue;

    const candles = await getPublicKlines(asset.pair, "1h", 100);
    if (candles.length < 30) continue;
    const ctx = buildContextFromCandles(asset.pair, "1h", candles);

    const maxPer = Number(settings?.max_per_trade ?? 500);
    const votes = runAllAgents(ctx as any, {
      weights, active,
      maxPositionValue: maxPer,
      walletBalance: Number(session.current_balance),
    });
    const decision = buildDecision(votes, weights, {
      min_favor_votes: Number(comSettings?.min_favor_votes ?? 6),
      min_confidence: Number(comSettings?.min_confidence ?? 70),
      min_score: Number(comSettings?.min_score ?? 61),
      default_stop_pct: Number(settings?.default_stop_pct ?? 3),
      default_target_pct: Number(settings?.default_take_pct ?? 6),
      max_position_value: maxPer,
    }, ctx.data_quality);

    // Persist decision
    const { data: decRow } = await supabase.from("committee_decisions").insert({
      asset_id: asset.id, pair: asset.pair, timeframe: "1h",
      final_decision: decision.final_decision, score: decision.score, classification: decision.classification,
      avg_confidence: decision.avg_confidence,
      votes_buy: decision.votes_buy, votes_sell: decision.votes_sell,
      votes_hold: decision.votes_hold, votes_wait: decision.votes_wait,
      risk_approved: decision.risk_approved, euphoria_vetoed: decision.euphoria_vetoed,
      data_quality: decision.data_quality, consolidated_justification: decision.consolidated_justification,
      context: ctx as any,
    }).select().single();

    if (decision.final_decision !== "buy_approved" && decision.final_decision !== "sell_approved") continue;

    const side = decision.final_decision === "buy_approved" ? "buy" : "sell";

    // Risk check
    const risk = await assertRisk(supabase, sessionId, asset.pair, maxPer, settings);
    if (!risk.ok) {
      await supabase.from("risk_events").insert({
        session_id: sessionId, kind: risk.kind, severity: "warning",
        message: risk.message, meta: { pair: asset.pair, decision_id: decRow?.id },
      });
      continue;
    }

    const qty = maxPer / ctx.price;
    const stopPct = Number(settings?.default_stop_pct ?? 3) / 100;
    const takePct = Number(settings?.default_take_pct ?? 6) / 100;
    const stop = side === "buy" ? ctx.price * (1 - stopPct) : ctx.price * (1 + stopPct);
    const take = side === "buy" ? ctx.price * (1 + takePct) : ctx.price * (1 - takePct);

    await supabase.from("live_simulated_positions").insert({
      session_id: sessionId, asset_id: asset.id, pair: asset.pair,
      side, qty, entry_price: ctx.price, stop_loss: stop, take_profit: take,
      decision_id: decRow?.id, last_price: ctx.price,
    });

    if (mode === "testnet" && isTestnetConfigured()) {
      try {
        const resp = await placeTestnetOrder({ symbol: asset.pair, side: side === "buy" ? "BUY" : "SELL", quantity: Number(qty.toFixed(5)) });
        await supabase.from("testnet_orders").insert({
          session_id: sessionId, asset_id: asset.id, pair: asset.pair,
          side: side.toUpperCase(), type: "MARKET", qty,
          stop_loss: stop, take_profit: take,
          binance_order_id: String(resp.orderId ?? ""), binance_status: resp.status ?? "NEW",
          raw_response: resp,
        });
      } catch (err) {
        await supabase.from("system_logs").insert({
          event_type: "Binance Testnet", source: "testnet", severity: "error",
          message: `Falha ao enviar ordem testnet: ${(err as Error).message}`,
        });
      }
    }

    await supabase.from("alerts").insert({
      type: "new_position", pair: asset.pair,
      message: `🚀 Nova ${side === "buy" ? "compra" : "venda"} ${asset.pair} @ ${ctx.price.toFixed(2)} (score ${decision.score.toFixed(0)})`,
      severity: "info",
    });
    openedCount++;
  }

  return { mode, closed: closedCount, opened: openedCount };
}

async function assertRisk(supabase: SupabaseClient, sessionId: string, _pair: string, notional: number, settings: any): Promise<{ ok: true } | { ok: false; kind: string; message: string }> {
  if (notional > Number(settings?.max_per_trade ?? Infinity)) return { ok: false, kind: "max_per_trade", message: `Notional ${notional} > limite por trade` };
  // exposure on open positions
  const { data: open } = await supabase.from("live_simulated_positions").select("qty, entry_price").eq("session_id", sessionId).eq("status", "open");
  const exposure = (open ?? []).reduce((s: number, p: any) => s + Number(p.qty) * Number(p.entry_price), 0);
  if (exposure + notional > Number(settings?.max_portfolio_exposure ?? Infinity)) return { ok: false, kind: "exposure_limit", message: `Exposição total excederia ${settings?.max_portfolio_exposure}` };
  // daily loss
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: closed } = await supabase.from("live_simulated_positions").select("pnl").eq("session_id", sessionId).eq("status", "closed").gte("exit_time", since);
  const dayPnl = (closed ?? []).reduce((s: number, p: any) => s + Number(p.pnl), 0);
  if (-dayPnl > Number(settings?.daily_loss_limit ?? Infinity)) return { ok: false, kind: "max_loss", message: `Perda diária atingida (${dayPnl.toFixed(2)})` };
  return { ok: true };
}

async function checkCircuitBreaker(supabase: SupabaseClient, sessionId: string, settings: any): Promise<{ tripped: false } | { tripped: true; trigger: string; reason: string }> {
  // Daily loss limit
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: closed } = await supabase.from("live_simulated_positions").select("pnl, exit_time").eq("session_id", sessionId).eq("status", "closed").gte("exit_time", since).order("exit_time", { ascending: false });
  const dayPnl = (closed ?? []).reduce((s: number, p: any) => s + Number(p.pnl), 0);
  if (-dayPnl > Number(settings?.daily_loss_limit ?? Infinity)) return { tripped: true, trigger: "daily_loss", reason: `Perda diária ${dayPnl.toFixed(2)} excedeu ${settings?.daily_loss_limit}` };
  // Loss streak
  let streak = 0;
  for (const p of closed ?? []) { if (Number(p.pnl) < 0) streak++; else break; }
  if (streak >= Number(settings?.max_loss_streak ?? Infinity)) return { tripped: true, trigger: "loss_streak", reason: `${streak} perdas consecutivas` };
  return { tripped: false };
}

export async function recomputeReputation(supabase: SupabaseClient, sessionId: string) {
  const { data: closed } = await supabase
    .from("live_simulated_positions")
    .select("pnl, decision_id")
    .eq("session_id", sessionId)
    .eq("status", "closed");
  if (!closed || closed.length === 0) return;
  const decisionIds = closed.map((c: any) => c.decision_id).filter(Boolean);
  if (decisionIds.length === 0) return;
  const { data: votes } = await supabase.from("agent_votes").select("agent_id, vote, decision_id").in("decision_id", decisionIds);
  const pnlByDecision = new Map<string, number>();
  for (const c of closed) if (c.decision_id) pnlByDecision.set(c.decision_id, Number(c.pnl));
  const stats = new Map<string, { good: number; bad: number; pnl: number }>();
  for (const v of votes ?? []) {
    const pnl = pnlByDecision.get(v.decision_id) ?? 0;
    if (!v.agent_id) continue;
    const s = stats.get(v.agent_id) ?? { good: 0, bad: 0, pnl: 0 };
    const aligned = (v.vote === "buy" && pnl > 0) || (v.vote === "sell" && pnl < 0);
    if (aligned) s.good++; else if (pnl !== 0) s.bad++;
    s.pnl += pnl;
    stats.set(v.agent_id, s);
  }
  for (const [agentId, s] of stats) {
    const total = s.good + s.bad;
    const hit = total ? (s.good / total) * 100 : 0;
    const weight = Math.max(0.3, Math.min(2, 0.5 + (hit / 100) * 1.5));
    await supabase.from("agents").update({ weight }).eq("id", agentId);
    await supabase.from("reputation_history").insert({
      agent_id: agentId, hit_rate: hit, weight, pnl_total: s.pnl, n_votes: total,
    });
  }
}
