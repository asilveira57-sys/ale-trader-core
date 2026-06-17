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

export async function runPipelineTick(sb: any) {
  const results: any = { collect: null, committee: [], autoCycle: [], monitor: null };
  results.collect = await collectMarketTick(sb);

  // Ensure an active session exists
  let { data: session } = await sb.from("trading_sessions").select("*").eq("status", "running").maybeSingle();
  if (!session) {
    const { data: newSession } = await sb.from("trading_sessions").insert({
      mode: "simulation", status: "running", started_at: new Date().toISOString(),
    }).select().single();
    session = newSession;
    await log(sb, "Sessão", "auto", `[cron] Sessão de simulação iniciada ${session?.id}`, "info");
  }

  const { data: assets } = await sb.from("monitored_assets").select("*").eq("active", true);
  for (const a of assets ?? []) {
    try { results.committee.push(await runCommitteeForAsset(sb, a, session?.id ?? null)); }
    catch (e) { results.committee.push({ pair: a.pair, error: (e as Error).message }); }
  }

  // Auto-cycle + position monitor
  try {
    const { runAutoCycle, monitorAutoPositions } = await import("./auto-trading.server");
    if (session?.id) results.autoCycle.push(await runAutoCycle(sb, session.id));
    results.monitor = await monitorAutoPositions(sb);
  } catch (e) {
    await log(sb, "AutoCycle", "auto", `[cron] erro: ${(e as Error).message}`, "warning");
  }
  return results;
}
