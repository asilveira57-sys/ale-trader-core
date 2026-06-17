// Phase 7 — Automated trading engine with multi-layer governance.
import type { SupabaseClient } from "@supabase/supabase-js";

export const LEVEL_LIMITS: Record<number, number> = { 1: 0.0025, 2: 0.005, 3: 0.01 };

export interface EligibilityResult {
  eligible: boolean;
  failedChecks: string[];
  details: Record<string, number | string | boolean | null>;
}

export async function checkAutoEligibility(supabase: SupabaseClient): Promise<EligibilityResult> {
  const { data: gov } = await supabase.from("governance_settings").select("*").limit(1).maybeSingle();
  const minDays = Number(gov?.eligibility_min_days ?? 60);
  const minTrades = Number(gov?.eligibility_min_trades ?? 200);
  const minPF = Number(gov?.eligibility_min_profit_factor ?? 1.3);
  const maxDD = Number(gov?.max_drawdown_pct ?? 15);

  const since = new Date(Date.now() - minDays * 86400_000).toISOString();
  const [{ data: trades }, { data: audits }, { data: riskAgent }, { data: cb }] = await Promise.all([
    supabase.from("live_simulated_positions").select("pnl, opened_at").eq("status", "closed").gte("opened_at", since),
    supabase.from("audit_reports").select("id"),
    supabase.from("agents").select("id").eq("active", true).ilike("name", "%risco%").limit(1).maybeSingle(),
    supabase.from("real_circuit_breaker_events").select("id").is("closed_at", null).limit(1).maybeSingle(),
  ]);

  const tradeCount = (trades ?? []).length;
  const wins = (trades ?? []).filter((t: any) => Number(t.pnl) > 0).reduce((s: number, t: any) => s + Number(t.pnl), 0);
  const losses = -(trades ?? []).filter((t: any) => Number(t.pnl) < 0).reduce((s: number, t: any) => s + Number(t.pnl), 0);
  const profitFactor = losses > 0 ? wins / losses : (wins > 0 ? 99 : 0);

  let peak = 0, eq = 0, maxDd = 0;
  for (const t of trades ?? []) {
    eq += Number(t.pnl ?? 0);
    if (eq > peak) peak = eq;
    if (peak - eq > maxDd) maxDd = peak - eq;
  }
  const ddPct = peak > 0 ? (maxDd / peak) * 100 : 0;

  const checks = {
    days: tradeCount > 0,
    trades_count: tradeCount >= minTrades,
    audited: (audits ?? []).length >= minTrades,
    profit_factor: profitFactor >= minPF,
    drawdown: ddPct <= maxDD,
    circuit_breaker: !cb,
    risk_agent: !!riskAgent,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return {
    eligible: failed.length === 0,
    failedChecks: failed,
    details: { tradeCount, profitFactor, drawdownPct: ddPct, minDays, minTrades, minPF, maxDD },
  };
}

export interface SizeInput {
  balance: number;
  volatility: number;     // 0..1 (e.g. 0.02 = 2%)
  recentPerformance: number; // -1..1
  drawdown: number;       // %
  confidence: number;     // 0..100
  level: number;          // 1|2|3
}

export async function computePositionSize(supabase: SupabaseClient, input: SizeInput): Promise<{ size: number; reason: string }> {
  const cap = (LEVEL_LIMITS[input.level] ?? LEVEL_LIMITS[1]) * input.balance;
  const confFactor = Math.max(0.3, input.confidence / 100);
  const volFactor = Math.max(0.4, 1 - input.volatility * 5);
  const ddFactor = input.drawdown > 10 ? 0.5 : input.drawdown > 5 ? 0.75 : 1;
  const perfFactor = input.recentPerformance < 0 ? 0.6 : 1;
  const size = cap * confFactor * volFactor * ddFactor * perfFactor;
  const reason = `cap=${cap.toFixed(2)} conf=${confFactor.toFixed(2)} vol=${volFactor.toFixed(2)} dd=${ddFactor.toFixed(2)} perf=${perfFactor.toFixed(2)}`;
  await supabase.from("capital_management_history").insert({
    balance: input.balance,
    suggested_size: cap,
    volatility: input.volatility,
    recent_performance: input.recentPerformance,
    current_drawdown: input.drawdown,
    confidence: input.confidence,
    final_size: size,
    reason,
  });
  return { size, reason };
}

export async function logIncident(
  supabase: SupabaseClient,
  kind: string, severity: "low" | "medium" | "high" | "critical",
  message: string, data: Record<string, number | string | boolean | null> = {},
) {
  await supabase.from("risk_incidents").insert({ kind, severity, message, data });
  if (severity === "critical" || severity === "high") {
    await supabase.from("alerts").insert({ type: kind, severity: severity === "critical" ? "critical" : "warning", message });
  }
}

export async function assertAutoCircuitBreaker(supabase: SupabaseClient): Promise<{ tripped: boolean; reason?: string }> {
  const { data: gov } = await supabase.from("governance_settings").select("*").limit(1).maybeSingle();
  if (!gov) return { tripped: false };

  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: closed } = await supabase.from("automated_trades").select("pnl, closed_at, opened_at")
    .eq("status", "closed").order("closed_at", { ascending: false }).limit(100);

  const day = (closed ?? []).filter((t: any) => t.closed_at && t.closed_at >= dayAgo);
  const week = (closed ?? []).filter((t: any) => t.closed_at && t.closed_at >= weekAgo);
  const dayLosses = day.filter((t: any) => Number(t.pnl) < 0).length;
  const weekLosses = week.filter((t: any) => Number(t.pnl) < 0).length;
  let streak = 0;
  for (const t of closed ?? []) { if (Number(t.pnl) < 0) streak++; else break; }

  const reasons: string[] = [];
  if (streak >= Number(gov.max_consecutive_losses)) reasons.push(`Sequência de perdas ${streak}`);
  if (dayLosses >= Number(gov.max_daily_losses)) reasons.push(`Perdas diárias ${dayLosses}`);
  if (weekLosses >= Number(gov.max_weekly_losses)) reasons.push(`Perdas semanais ${weekLosses}`);

  if (reasons.length > 0) {
    const reason = reasons.join("; ");
    await activateKillSwitch(supabase, `Auto-CB: ${reason}`);
    await logIncident(supabase, "loss_streak", "critical", reason, { dayLosses, weekLosses, streak });
    return { tripped: true, reason };
  }
  return { tripped: false };
}

export async function activateKillSwitch(supabase: SupabaseClient, reason: string) {
  const { data: gov } = await supabase.from("governance_settings").select("id").limit(1).maybeSingle();
  if (gov) {
    await supabase.from("governance_settings").update({
      kill_switch_active: true,
      kill_switch_activated_at: new Date().toISOString(),
      kill_switch_reason: reason,
      automation_enabled: false,
    }).eq("id", gov.id);
  }
  await supabase.from("risk_incidents").insert({
    kind: "kill_switch", severity: "critical", message: reason,
  });
  await supabase.from("alerts").insert({ type: "kill_switch", severity: "critical", message: `🛑 KILL SWITCH: ${reason}` });
  try {
    const { getRealOpenOrders, cancelRealOrder } = await import("./binance-real.server");
    const open = await getRealOpenOrders().catch(() => []);
    for (const o of open as any[]) {
      try { await cancelRealOrder(o.symbol, o.orderId, "kill-switch"); } catch { /* ignore */ }
    }
  } catch { /* binance not configured */ }
}

export async function deactivateKillSwitch(supabase: SupabaseClient) {
  const { data: gov } = await supabase.from("governance_settings").select("id").limit(1).maybeSingle();
  if (gov) {
    await supabase.from("governance_settings").update({
      kill_switch_active: false,
      kill_switch_reason: null,
    }).eq("id", gov.id);
  }
}

export interface AutoCycleResult {
  status: "skipped" | "no_signal" | "blocked" | "executed";
  reason?: string;
  trade_id?: string;
}

export async function runAutoCycle(supabase: SupabaseClient, sessionId: string): Promise<AutoCycleResult> {
  const { data: gov } = await supabase.from("governance_settings").select("*").limit(1).maybeSingle();
  if (!gov) return { status: "skipped", reason: "Sem governance_settings" };
  if (gov.kill_switch_active) return { status: "skipped", reason: "Kill switch ativo" };
  if (!gov.automation_enabled) return { status: "skipped", reason: "Automação desabilitada" };
  if (!gov.supervisor_enabled) return { status: "skipped", reason: "Supervisor desabilitado" };

  const elig = await checkAutoEligibility(supabase);
  if (!elig.eligible) return { status: "skipped", reason: `Inelegível: ${elig.failedChecks.join(",")}` };

  const cb = await assertAutoCircuitBreaker(supabase);
  if (cb.tripped) return { status: "blocked", reason: cb.reason };

  const { getLatestConfidence } = await import("./confidence.server");
  const conf = await getLatestConfidence(supabase);
  if (!conf || conf.score < Number(gov.min_confidence_score)) {
    return { status: "skipped", reason: `Confiança ${conf?.score ?? 0} < ${gov.min_confidence_score}` };
  }

  // Use latest committee decision per asset within this session.
  const { data: decisions } = await supabase
    .from("committee_decisions").select("*")
    .eq("session_id", sessionId)
    .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .order("created_at", { ascending: false }).limit(5);

  if (!decisions?.length) return { status: "no_signal" };

  for (const d of decisions) {
    if (d.action !== "buy" && d.action !== "sell") continue;
    if (Number(d.score ?? 0) < Number(gov.min_score_for_auto)) continue;
    if (Number(d.consensus ?? 0) < Number(gov.min_consensus_for_auto)) continue;

    // Create real_trade_request marked automated.
    const risk = Math.abs((Number(d.price) - Number(d.stop_loss ?? d.price)) * 1);
    const { data: req } = await supabase.from("real_trade_requests").insert({
      pair: d.pair, side: d.action,
      suggested_qty: 0, suggested_price: d.price,
      stop_loss: d.stop_loss, take_profit: d.take_profit,
      risk_amount: risk, score: d.score,
      votes_for: d.votes_for ?? 0, votes_against: d.votes_against ?? 0, vetoes: d.vetoes ?? [],
      justification: `Auto Fase 7 — session ${sessionId}`,
      worst_case: -risk, expected_result: Math.abs((Number(d.take_profit ?? d.price) - Number(d.price))),
      checklist: { automated: true }, status: "pending",
    }).select().single();
    if (!req) continue;

    // Supervisor.
    const { runSupervisor } = await import("./supervisor.server");
    const review = await runSupervisor(supabase, {
      requestId: req.id, pair: d.pair, side: d.action,
      price: Number(d.price), stop: Number(d.stop_loss ?? d.price),
      take: Number(d.take_profit ?? d.price), score: Number(d.score),
      consensus: Number(d.consensus), votesFor: Number(d.votes_for ?? 0),
      votesAgainst: Number(d.votes_against ?? 0), vetoes: d.vetoes ?? [],
    });
    if (review.verdict !== "approved") {
      await supabase.from("real_trade_requests").update({ status: "rejected" }).eq("id", req.id);
      return { status: "blocked", reason: `Supervisor: ${review.justification}` };
    }

    // Position sizing.
    const balance = 1000; // TODO: from real Binance account when configured.
    const { computePositionSize } = await import("./auto-trading.server");
    const { size } = await computePositionSize(supabase, {
      balance, volatility: 0.02, recentPerformance: 0,
      drawdown: 100 - conf.drawdown_component, confidence: conf.score,
      level: Number(gov.automation_level),
    });
    const qty = Number((size / Number(d.price)).toFixed(6));
    if (qty <= 0) return { status: "blocked", reason: "Tamanho calculado = 0" };

    await supabase.from("real_trade_requests").update({ status: "approved", suggested_qty: qty }).eq("id", req.id);

    // Execute via auto-only function (no manual approval req).
    const { placeAutoRealOrder } = await import("./binance-real.server");
    let orderResp: any;
    try {
      orderResp = await placeAutoRealOrder({
        symbol: d.pair, side: d.action === "buy" ? "BUY" : "SELL",
        type: "MARKET", quantity: qty, approvedRequestId: req.id,
      });
    } catch (err) {
      await logIncident(supabase, "binance_failure", "high", `Falha ao executar: ${(err as Error).message}`);
      await supabase.from("real_trade_requests").update({ status: "failed" }).eq("id", req.id);
      return { status: "blocked", reason: (err as Error).message };
    }

    const { data: trade } = await supabase.from("automated_trades").insert({
      request_id: req.id, session_id: sessionId, asset_id: d.asset_id,
      side: d.action, qty, entry_price: d.price,
      stop_loss: d.stop_loss, take_profit: d.take_profit, risk_amount: risk,
      automation_level: gov.automation_level, score: d.score, consensus: d.consensus,
      supervisor_decision: review.verdict, status: "open",
    }).select().single();

    await supabase.from("automated_trade_audits").insert({
      automated_trade_id: trade?.id, phase: "entry",
      summary: `Entrada ${d.action.toUpperCase()} ${d.pair} qty=${qty}`,
      content: `Decisão executada automaticamente. Confiança: ${conf.score}. Score: ${d.score}. Consenso: ${d.consensus}. Supervisor: ${review.justification}.`,
      decision_chain: { committee: d, supervisor: review, sizing: { qty, size }, binance: orderResp },
    });
    return { status: "executed", trade_id: trade?.id };
  }
  return { status: "no_signal" };
}

export async function monitorAutoPositions(supabase: SupabaseClient): Promise<{ closed: number }> {
  const { data: open } = await supabase.from("automated_trades").select("*").eq("status", "open");
  if (!open?.length) return { closed: 0 };
  const { getPublicTicker } = await import("./binance-testnet.server");
  let closed = 0;
  for (const t of open) {
    const tk = await getPublicTicker(`${(await supabase.from("monitored_assets").select("pair").eq("id", t.asset_id).maybeSingle()).data?.pair ?? ""}`).catch(() => null);
    const price = tk?.price ?? Number(t.entry_price);
    const dir = t.side === "buy" ? 1 : -1;
    const pnl = (price - Number(t.entry_price)) * Number(t.qty) * dir;
    const pnlPct = ((price - Number(t.entry_price)) / Number(t.entry_price)) * 100 * dir;

    let exitReason: string | null = null;
    if (t.stop_loss && ((dir === 1 && price <= Number(t.stop_loss)) || (dir === -1 && price >= Number(t.stop_loss)))) exitReason = "stop_loss";
    else if (t.take_profit && ((dir === 1 && price >= Number(t.take_profit)) || (dir === -1 && price <= Number(t.take_profit)))) exitReason = "take_profit";

    if (exitReason) {
      await supabase.from("automated_trades").update({
        status: "closed", exit_price: price, exit_reason: exitReason,
        pnl, pnl_pct: pnlPct, closed_at: new Date().toISOString(),
      }).eq("id", t.id);
      await supabase.from("automated_trade_audits").insert({
        automated_trade_id: t.id, phase: "exit",
        summary: `Saída ${exitReason} @ ${price.toFixed(2)} PnL ${pnl.toFixed(2)}`,
        content: `Posição encerrada automaticamente por ${exitReason}.`,
        decision_chain: { price, pnl, pnl_pct: pnlPct },
      });
      closed++;
    }
  }
  return { closed };
}

export async function evolveAgentWeights(supabase: SupabaseClient, windowDays = 14): Promise<{ updated: number }> {
  const { data: reps } = await supabase.from("agent_reputation").select("agent_id, score, hits, misses");
  const { data: agents } = await supabase.from("agents").select("id, weight, min_weight, max_weight");
  let updated = 0;
  for (const a of agents ?? []) {
    const rep = (reps ?? []).find((r: any) => r.agent_id === a.id);
    if (!rep) continue;
    const total = Number(rep.hits ?? 0) + Number(rep.misses ?? 0);
    if (total < 5) continue;
    const accuracy = Number(rep.hits) / total;
    const target = 0.5 + (accuracy - 0.5) * 2; // -0.5..1.5
    const newW = Math.max(Number(a.min_weight ?? 0.1), Math.min(Number(a.max_weight ?? 2), target));
    if (Math.abs(newW - Number(a.weight)) < 0.05) continue;
    await supabase.from("dynamic_agent_weights").insert({
      agent_id: a.id, previous_weight: a.weight, new_weight: newW,
      reason: `accuracy=${(accuracy * 100).toFixed(1)}% n=${total}`,
      performance_window: windowDays,
    });
    await supabase.from("agents").update({ weight: newW }).eq("id", a.id);
    updated++;
  }
  return { updated };
}
