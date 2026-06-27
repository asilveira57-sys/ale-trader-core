// Service-role pipeline runner — called by the public cron hook.
// Implements: collect market → run committee per asset → auto-cycle.

import { runAllAgents, buildDecision, buildMockContext } from "./committee.server";

function mockPrice(pair: string) {
  const base: Record<string, number> = {
    BTCUSDT: 67000, ETHUSDT: 3500, SOLUSDT: 165, XRPUSDT: 0.58, BNBUSDT: 605,
  };
  const seed = (Date.now() / 60000) | 0;
  let h = 0;
  for (const c of pair + seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const noise = ((h % 1000) / 1000 - 0.5) * 0.04;
  return (base[pair] ?? 100) * (1 + noise);
}

async function log(sb: any, event_type: string, source: string, message: string, severity = "info", technical_data?: unknown) {
  await sb.from("system_logs").insert({ event_type, source, message, severity, technical_data: technical_data ?? null });
}

export async function collectMarketTick(sb: any) {
  const { data: settings } = await sb.from("robot_settings").select("*").eq("id", 1).maybeSingle();
  if (settings?.status === "paused") return { skipped: true };
  const { data: assets } = await sb.from("monitored_assets").select("*").eq("active", true);
  const useMock = settings?.binance_mock_mode ?? true;
  const snapshots: any[] = [];
  for (const a of assets ?? []) {
    const price = mockPrice(a.pair);
    const change = (Math.random() - 0.5) * 8;
    snapshots.push({
      pair: a.pair, price, change_percent_24h: change,
      volume_24h: 1_000_000 * (1 + Math.random()),
      high_24h: price * 1.02, low_24h: price * 0.98,
    });
  }
  if (snapshots.length) await sb.from("market_snapshots").insert(snapshots);
  await sb.from("binance_connection_status").update({
    connected: true, last_check: new Date().toISOString(),
    account_type: useMock ? "MOCK" : "SPOT", permissions: ["READ"], last_error: null,
  }).eq("id", 1);
  await log(sb, "API Binance", "binance", `[cron] Coleta concluída: ${snapshots.length} ativos`, "info");
  return { collected: snapshots.length };
}

export async function runCommitteeForAsset(sb: any, asset: any, sessionId: string | null, timeframe = "1h") {
  const [{ data: settings }, { data: agents }, { data: wallet }] = await Promise.all([
    sb.from("committee_settings").select("*").eq("id", 1).maybeSingle(),
    sb.from("agents").select("*"),
    sb.from("simulated_wallet").select("*").eq("id", 1).maybeSingle(),
  ]);

  const weights: Record<string, number> = {};
  const active: Record<string, boolean> = {};
  for (const a of agents ?? []) { weights[a.name] = Number(a.weight ?? 1); active[a.name] = a.active !== false; }

  const price = mockPrice(asset.pair);
  const ctx = buildMockContext(asset.pair, timeframe, price);
  const votes = runAllAgents(ctx, {
    weights, active,
    maxPositionValue: Number(settings?.max_position_value ?? 1000),
    walletBalance: Number(wallet?.current_balance ?? 10000),
  });

  const decision = buildDecision(votes, weights, {
    min_favor_votes: Number(settings?.min_favor_votes ?? 6),
    min_confidence: Number(settings?.min_confidence ?? 70),
    min_score: Number(settings?.min_score ?? 61),
    default_stop_pct: Number(settings?.default_stop_pct ?? 3),
    default_target_pct: Number(settings?.default_target_pct ?? 6),
    max_position_value: Number(settings?.max_position_value ?? 1000),
  }, ctx.data_quality);

  const row: any = {
    asset_id: asset.id, pair: asset.pair, timeframe,
    final_decision: decision.final_decision, score: decision.score,
    classification: decision.classification, avg_confidence: decision.avg_confidence,
    votes_buy: decision.votes_buy, votes_sell: decision.votes_sell,
    votes_hold: decision.votes_hold, votes_wait: decision.votes_wait,
    risk_approved: decision.risk_approved, euphoria_vetoed: decision.euphoria_vetoed,
    data_quality: decision.data_quality, consolidated_justification: decision.consolidated_justification,
    context: ctx as any,
  };
  if (sessionId) row.session_id = sessionId;
  const { data: decRow, error: decErr } = await sb.from("committee_decisions").insert(row).select().single();
  if (decErr) throw new Error(decErr.message);

  const agentByName: Record<string, string> = {};
  for (const a of agents ?? []) agentByName[a.name] = a.id;
  const voteRows = votes.filter((v) => agentByName[v.agent]).map((v) => ({
    agent_id: agentByName[v.agent], pair: asset.pair, vote: v.vote,
    confidence: v.confidence, justification: v.justification,
    decision_id: decRow.id, data_used: v.data_used as any,
    perceived_risk: v.perceived_risk, has_veto: v.has_veto, veto_reason: v.veto_reason ?? null,
  }));
  if (voteRows.length) await sb.from("agent_votes").insert(voteRows);

  return { decision_id: decRow.id, final: decision.final_decision, score: decision.score };
}

async function executeSimulated(sb: any, decision: any, ctx: any, asset: any, settings: any) {
  if (decision.final_decision !== "buy_approved" && decision.final_decision !== "sell_approved") return null;
  const side = decision.final_decision === "buy_approved" ? "buy" : "sell";
  const { data: wallet } = await sb.from("simulated_wallet").select("*").eq("id", 1).maybeSingle();
  const { data: pos } = await sb.from("simulated_positions").select("*").eq("pair", asset.pair).maybeSingle();
  const price = Number(ctx.price);

  const feePct = Number(settings?.taker_fee_pct ?? 0.1) / 100;

  // ===== Fase 2A: Brain gate (analyzeBrain) — bloqueia execução com base no score, taxa e conflito multitemporal =====
  try {
    const symbol = String(asset.pair).replace("/", "").toUpperCase();
    const { analyzeBrain, loadIndicatorWeights } = await import("./binance-brain.server");
    const positionValueGuess = Math.min(
      Number(settings?.max_position_value ?? 1000),
      Number(wallet?.current_balance ?? 0) * Number(settings?.per_trade_capital_pct ?? 0.35),
    );
    const indWeights = await loadIndicatorWeights();
    const brain = await analyzeBrain(symbol, { side, notional: positionValueGuess > 0 ? positionValueGuess : 100, weights: indWeights });

    const { count: sampleCount } = await sb.from("binance_brain_audit").select("id", { count: "exact", head: true });
    const sample = sampleCount ?? 0;
    const flexMode = sample < 300;
    const minScore = flexMode ? 45 : 51;

    const brainBlockReasons: string[] = [];
    if (!brain.feeGatePassed) brainBlockReasons.push(`Cérebro: lucro líquido esperado (${brain.expectedNet.toFixed(4)}) não cobre 3× taxas (${(brain.feeBuy + brain.feeSell).toFixed(4)})`);
    if (brain.score < minScore) brainBlockReasons.push(`Cérebro: score ${brain.score.toFixed(0)} < mínimo ${minScore}${flexMode ? " (flex)" : ""}`);
    if (brain.timeframeConflict && !flexMode) brainBlockReasons.push(`Cérebro: conflito multitemporal (tendência dominante ${brain.dominantTrend})`);
    if (side === "buy" && brain.dominantTrend.startsWith("Baixa")) brainBlockReasons.push(`Cérebro: BUY contra tendência dominante (${brain.dominantTrend})`);
    if (side === "sell" && brain.dominantTrend.startsWith("Alta")) brainBlockReasons.push(`Cérebro: SELL contra tendência dominante (${brain.dominantTrend})`);

    // Sempre persiste o áudito da análise — independente de aprovação
    const votesObj: Record<string, { vote: string; detail: string; value?: number }> = {};
    for (const v of brain.indicators) votesObj[v.indicator] = { vote: v.vote, detail: v.detail, value: v.value };
    await sb.from("binance_brain_audit").insert({
      symbol: brain.symbol, side: brain.side, price: brain.price, notional: positionValueGuess,
      trend_1m: brain.timeframes.find((t) => t.tf === "1m")?.trend ?? null,
      trend_5m: brain.timeframes.find((t) => t.tf === "5m")?.trend ?? null,
      trend_15m: brain.timeframes.find((t) => t.tf === "15m")?.trend ?? null,
      trend_1h: brain.timeframes.find((t) => t.tf === "1h")?.trend ?? null,
      trend_4h: brain.timeframes.find((t) => t.tf === "4h")?.trend ?? null,
      trend_1d: brain.timeframes.find((t) => t.tf === "1d")?.trend ?? null,
      trend_7d: brain.timeframes.find((t) => t.tf === "7d")?.trend ?? null,
      trend_15d: brain.timeframes.find((t) => t.tf === "15d")?.trend ?? null,
      trend_30d: brain.timeframes.find((t) => t.tf === "30d")?.trend ?? null,
      dominant_trend: brain.dominantTrend, timeframe_conflict: brain.timeframeConflict,
      indicator_votes: votesObj, approve_count: brain.approve, reject_count: brain.reject, neutral_count: brain.neutral,
      score: brain.score, classification: brain.classification,
      fee_buy: brain.feeBuy, fee_sell: brain.feeSell, spread_pct: brain.spreadPct, slippage_pct: brain.slippagePct,
      expected_gross: brain.expectedGross, expected_net: brain.expectedNet, fee_gate_passed: brain.feeGatePassed,
      volatility_class: brain.volatilityClass, volume_signal: brain.volumeSignal, fib_levels: brain.fibLevels,
      rationale: brain.rationale, brain_recommendation: brainBlockReasons.length ? "BLOCKED" : brain.recommendation,
      flex_mode: flexMode, sample_size: sample,
      related_decision_id: decision.id,
    });

    if (brainBlockReasons.length) {
      await sb.from("binance_trade_block_log").insert({
        pair: asset.pair, decision_id: decision.id, reason: brainBlockReasons.join(" | "),
        expected_net_profit: brain.expectedNet, expected_roi_pct: 0,
        total_fees_estimated: brain.feeBuy + brain.feeSell, position_value: positionValueGuess,
        details: { brain_score: brain.score, classification: brain.classification, dominant_trend: brain.dominantTrend, flex_mode: flexMode, sample },
      });
      await log(sb, "Execução", "sim", `[cron] ${side.toUpperCase()} ${asset.pair} BLOQUEADO pelo Cérebro: ${brainBlockReasons.join("; ")}`, "warning");
      return null;
    }
  } catch (err: any) {
    // Falha do cérebro não deve quebrar o ciclo — apenas registra e segue.
    await log(sb, "Execução", "sim", `[cron] Cérebro indisponível para ${asset.pair}: ${err?.message ?? err}`, "warning");
  }
  // ===== fim do brain gate =====

  // SELL = close existing long. Skip if no long position.
  if (side === "sell") {
    const longQty = Number(pos?.quantity ?? 0);
    if (longQty <= 0) {
      await log(sb, "Execução", "sim", `[cron] SELL ${asset.pair} ignorado: sem posição comprada para vender`, "warning");
      return null;
    }
    const qty = Number(longQty.toFixed(6));
    const avg = Number(pos!.avg_price);
    const proceeds = qty * price;
    const cost = qty * avg;
    const grossPnl = proceeds - cost;
    const { data: openBuys } = await sb.from("simulated_orders")
      .select("buy_fee, decision_id").eq("pair", asset.pair).eq("side", "buy").eq("status", "open");
    const buyFee = (openBuys ?? []).reduce((s: number, o: any) => s + Number(o.buy_fee ?? 0), 0);
    const sellFee = proceeds * feePct;
    const totalFees = buyFee + sellFee;
    const netPnl = grossPnl - totalFees;
    const grossRoi = cost > 0 ? (grossPnl / cost) * 100 : 0;
    const netRoi = cost > 0 ? (netPnl / cost) * 100 : 0;
    const closedAt = new Date().toISOString();
    await sb.from("simulated_orders").insert({
      decision_id: decision.id, pair: asset.pair, side: "sell", quantity: qty,
      entry_price: avg, closed_price: price, realized_pnl: netPnl,
      stop_price: price * 0.97, target_price: price * 1.03, score: decision.score,
      agents_favor: decision.votes_sell, agents_against: decision.votes_buy,
      justification: decision.consolidated_justification,
      status: "closed", closed_at: closedAt,
      buy_fee: buyFee, sell_fee: sellFee, total_fees: totalFees,
      gross_pnl: grossPnl, net_pnl: netPnl,
      gross_roi_pct: grossRoi, net_roi_pct: netRoi,
    });
    await sb.from("simulated_orders")
      .update({ status: "closed", closed_price: price, realized_pnl: netPnl, closed_at: closedAt,
        sell_fee: sellFee, total_fees: totalFees, gross_pnl: grossPnl, net_pnl: netPnl,
        gross_roi_pct: grossRoi, net_roi_pct: netRoi })
      .eq("pair", asset.pair).eq("side", "buy").eq("status", "open");
    await sb.from("simulated_positions").update({ quantity: 0, unrealized_pnl: 0 }).eq("pair", asset.pair);
    const newBalance = Number(wallet?.current_balance ?? 0) + proceeds - sellFee;
    await sb.from("simulated_wallet").update({ current_balance: newBalance, equity: newBalance }).eq("id", 1);
    await log(sb, "Execução", "sim", `[cron] SELL ${asset.pair} qty=${qty} @ ${price.toFixed(2)} netPnl=${netPnl.toFixed(2)} fees=${totalFees.toFixed(2)}`, "info");
    return { pair: asset.pair, side, qty, price, netPnl, totalFees };
  }

  // BUY = open long.
  const perTradeMultiplier = Number(settings?.per_trade_capital_pct ?? 0.35);
  const positionValue = Math.min(
    Number(settings?.max_position_value ?? 1000),
    Number(wallet?.current_balance ?? 0) * perTradeMultiplier,
  );
  if (positionValue <= 10) return null;

  // ===== Profit guard =====
  const targetPct = Number(settings?.default_target_pct ?? 6) / 100;
  const stopPct = Number(settings?.default_stop_pct ?? 3) / 100;
  const expectedExitPrice = price * (1 + targetPct);
  const expectedGrossPnl = (expectedExitPrice - price) * (positionValue / price);
  const buyFeeEst = positionValue * feePct;
  const sellFeeEst = (positionValue + expectedGrossPnl) * feePct;
  const totalFeesEst = buyFeeEst + sellFeeEst;
  const expectedNetPnl = expectedGrossPnl - totalFeesEst;
  const expectedRoi = (expectedNetPnl / positionValue) * 100;
  const minRoi = Number(settings?.min_expected_roi_pct ?? 0.5);
  const minNetUsd = Number(settings?.min_net_profit_usd ?? 5);
  const feeMult = Number(settings?.fee_coverage_multiplier ?? 3);

  const blockReasons: string[] = [];
  if (expectedNetPnl < feeMult * totalFeesEst) blockReasons.push(`Lucro líquido esperado (${expectedNetPnl.toFixed(2)}) < ${feeMult}× taxas (${(feeMult * totalFeesEst).toFixed(2)})`);
  if (expectedRoi < minRoi) blockReasons.push(`ROI esperado abaixo do mínimo operacional (${expectedRoi.toFixed(3)}% < ${minRoi}%)`);
  if (expectedNetPnl < minNetUsd) blockReasons.push(`Lucro líquido previsto insuficiente (${expectedNetPnl.toFixed(2)} < ${minNetUsd})`);

  if (blockReasons.length) {
    await sb.from("binance_trade_block_log").insert({
      pair: asset.pair, decision_id: decision.id, reason: blockReasons.join(" | "),
      expected_net_profit: expectedNetPnl, expected_roi_pct: expectedRoi,
      total_fees_estimated: totalFeesEst, position_value: positionValue,
      details: { price, expectedExitPrice, targetPct, stopPct, feePct, buyFeeEst, sellFeeEst, minRoi, minNetUsd, feeMult },
    });
    await log(sb, "Execução", "sim", `[cron] BUY ${asset.pair} BLOQUEADO: ${blockReasons.join("; ")}`, "warning");
    return null;
  }

  const qty = Number((positionValue / price).toFixed(6));
  const stop = price * (1 - stopPct);
  const target = price * (1 + targetPct);

  const { data: existing } = await sb.from("simulated_orders")
    .select("id").eq("pair", asset.pair).eq("side", "buy").eq("status", "open").limit(1);
  if (existing && existing.length) return null;

  const buyFee = positionValue * feePct;
  await sb.from("simulated_orders").insert({
    decision_id: decision.id, pair: asset.pair, side: "buy", quantity: qty, entry_price: price,
    stop_price: stop, target_price: target, score: decision.score,
    agents_favor: decision.votes_buy, agents_against: decision.votes_sell,
    justification: decision.consolidated_justification, status: "open",
    buy_fee: buyFee, total_fees: buyFee,
    expected_net_profit: expectedNetPnl, expected_roi_pct: expectedRoi,
  });
  const newQty = Number(pos?.quantity ?? 0) + qty;
  const newAvg = newQty > 0
    ? ((Number(pos?.avg_price ?? 0) * Number(pos?.quantity ?? 0)) + price * qty) / newQty
    : price;
  await sb.from("simulated_positions").upsert({
    pair: asset.pair, quantity: newQty, avg_price: newAvg, unrealized_pnl: 0,
  }, { onConflict: "pair" });
  const newBalance = Number(wallet?.current_balance ?? 0) - positionValue - buyFee;
  await sb.from("simulated_wallet").update({ current_balance: newBalance, equity: newBalance }).eq("id", 1);
  await log(sb, "Execução", "sim", `[cron] BUY ${asset.pair} qty=${qty} @ ${price.toFixed(2)} fee=${buyFee.toFixed(2)} expROI=${expectedRoi.toFixed(2)}%`, "info");
  return { pair: asset.pair, side, qty, price, buyFee };
}

async function monitorSimulatedOrders(sb: any) {
  const { data: open } = await sb.from("simulated_orders").select("*").eq("status", "open");
  const { data: cs } = await sb.from("committee_settings").select("taker_fee_pct").eq("id", 1).maybeSingle();
  const feePct = Number(cs?.taker_fee_pct ?? 0.1) / 100;
  let closed = 0;
  for (const o of open ?? []) {
    const price = mockPrice(o.pair);
    const hitStop = o.side === "buy" ? price <= Number(o.stop_price) : price >= Number(o.stop_price);
    const hitTarget = o.side === "buy" ? price >= Number(o.target_price) : price <= Number(o.target_price);
    if (!hitStop && !hitTarget) {
      const pnl = (price - Number(o.entry_price)) * Number(o.quantity) * (o.side === "buy" ? 1 : -1);
      await sb.from("simulated_positions").update({ unrealized_pnl: pnl }).eq("pair", o.pair);
      continue;
    }
    const exitPrice = hitTarget ? Number(o.target_price) : Number(o.stop_price);
    const grossPnl = (exitPrice - Number(o.entry_price)) * Number(o.quantity) * (o.side === "buy" ? 1 : -1);
    const sellProceeds = exitPrice * Number(o.quantity);
    const sellFee = sellProceeds * feePct;
    const buyFee = Number(o.buy_fee ?? 0);
    const totalFees = buyFee + sellFee;
    const netPnl = grossPnl - totalFees;
    const cost = Number(o.entry_price) * Number(o.quantity);
    const grossRoi = cost > 0 ? (grossPnl / cost) * 100 : 0;
    const netRoi = cost > 0 ? (netPnl / cost) * 100 : 0;
    await sb.from("simulated_orders").update({
      status: "closed", closed_price: exitPrice, realized_pnl: netPnl, closed_at: new Date().toISOString(),
      sell_fee: sellFee, total_fees: totalFees, gross_pnl: grossPnl, net_pnl: netPnl,
      gross_roi_pct: grossRoi, net_roi_pct: netRoi,
    }).eq("id", o.id);
    const positionValue = cost;
    const { data: wallet } = await sb.from("simulated_wallet").select("*").eq("id", 1).maybeSingle();
    const newBalance = Number(wallet?.current_balance ?? 0) + (o.side === "buy" ? positionValue + grossPnl - sellFee : -positionValue + grossPnl - sellFee);
    await sb.from("simulated_wallet").update({ current_balance: newBalance, equity: newBalance }).eq("id", 1);
    const { data: pos } = await sb.from("simulated_positions").select("*").eq("pair", o.pair).maybeSingle();
    if (pos) {
      const newQty = Number(pos.quantity) - (o.side === "buy" ? Number(o.quantity) : -Number(o.quantity));
      await sb.from("simulated_positions").update({ quantity: newQty, unrealized_pnl: 0 }).eq("pair", o.pair);
    }
    await log(sb, "Execução", "sim", `[cron] CLOSE ${o.pair} ${hitTarget ? "TP" : "SL"} netPnl=${netPnl.toFixed(2)} fees=${totalFees.toFixed(2)}`, "info");
    closed++;
  }
  return { closed };
}

export async function runPipelineTick(sb: any) {
  const results: any = { collect: null, committee: [], executed: [], monitor: null, skipped: false };

  // Respect the global Binance pause flag — when paused, no collection, no votes, no execution.
  const { data: rs } = await sb.from("robot_settings").select("status").eq("id", 1).maybeSingle();
  if (rs?.status === "paused") {
    results.skipped = true;
    results.reason = "robot_paused";
    return results;
  }

  results.collect = await collectMarketTick(sb);

  let { data: session } = await sb.from("trading_sessions").select("*").eq("status", "running").maybeSingle();
  if (!session) {
    const { data: newSession } = await sb.from("trading_sessions").insert({
      mode: "simulation", status: "running", started_at: new Date().toISOString(),
    }).select().single();
    session = newSession;
    await log(sb, "Sessão", "auto", `[cron] Sessão de simulação iniciada ${session?.id}`, "info");
  }

  const { data: settings } = await sb.from("committee_settings").select("*").eq("id", 1).maybeSingle();
  const { data: assets } = await sb.from("monitored_assets").select("*").eq("active", true);
  for (const a of assets ?? []) {
    try {
      const r = await runCommitteeForAsset(sb, a, session?.id ?? null);
      results.committee.push(r);
      const { data: dec } = await sb.from("committee_decisions").select("*").eq("id", r.decision_id).single();
      const price = mockPrice(a.pair);
      const exec = await executeSimulated(sb, dec, { price }, a, settings);
      if (exec) results.executed.push(exec);
    } catch (e) {
      results.committee.push({ pair: a.pair, error: (e as Error).message });
    }
  }

  results.monitor = await monitorSimulatedOrders(sb);
  return results;
}
