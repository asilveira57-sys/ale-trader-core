// Phase 8 — Strategic Intelligence Center: core server logic.
// Owner-only. Never mutates risk/limits/permissions on its own — always proposes via learning_recommendations.

import { embed, chat } from "./ai-gateway.server";

async function getAdmin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

// ---------- Strategic Memory ----------

export async function ingestMemory(input: {
  kind: string;
  asset_id?: string | null;
  ref_table?: string | null;
  ref_id?: string | null;
  title?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const sb = await getAdmin();
  let embedding: number[] | null = null;
  try {
    const v = await embed(input.content.slice(0, 6000));
    embedding = v[0] ?? null;
  } catch (e) {
    console.warn("[intelligence] embed failed", e);
  }
  const { data, error } = await sb
    .from("strategic_memory")
    .insert({
      kind: input.kind,
      asset_id: input.asset_id ?? null,
      ref_table: input.ref_table ?? null,
      ref_id: input.ref_id ?? null,
      title: input.title ?? null,
      content: input.content,
      embedding: embedding as any,
      metadata: (input.metadata ?? {}) as any,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function searchMemory(query: string, opts: { kind?: string; asset_id?: string; limit?: number } = {}) {
  const sb = await getAdmin();
  const v = await embed(query);
  const { data, error } = await sb.rpc("match_strategic_memory", {
    p_query_embedding: v[0] as any,
    p_match_count: opts.limit ?? 10,
    p_kind: opts.kind ?? null,
    p_asset_id: opts.asset_id ?? null,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- Market Regime Detector ----------

export type Regime = "bull" | "bear" | "sideways" | "high_volatility" | "low_volatility";

export async function detectRegimeFromCandles(candles: { close: number }[]): Promise<{ regime: Regime; confidence: number; volatility: number; trend_strength: number }> {
  if (candles.length < 20) {
    return { regime: "sideways", confidence: 0.2, volatility: 0, trend_strength: 0 };
  }
  const closes = candles.map((c) => Number(c.close));
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const vol = Math.sqrt(variance);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const totalReturn = (last - first) / first;
  const trend = totalReturn / (vol * Math.sqrt(closes.length) || 1);

  let regime: Regime;
  if (vol > 0.04) regime = "high_volatility";
  else if (vol < 0.005) regime = "low_volatility";
  else if (trend > 0.5) regime = "bull";
  else if (trend < -0.5) regime = "bear";
  else regime = "sideways";

  const confidence = Math.min(1, Math.abs(trend) / 2 + (vol > 0.04 || vol < 0.005 ? 0.4 : 0.2));
  return { regime, confidence, volatility: vol, trend_strength: trend };
}

export async function recordRegime(assetId: string | null, candles: { close: number }[]) {
  const r = await detectRegimeFromCandles(candles);
  const sb = await getAdmin();
  const { error } = await sb.from("market_regimes").insert({
    asset_id: assetId,
    regime: r.regime,
    confidence: r.confidence,
    volatility: r.volatility,
    trend_strength: r.trend_strength,
  });
  if (error) throw new Error(error.message);
  return r;
}

// ---------- Agent Rankings ----------

const PERIOD_DAYS: Record<string, number> = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 };

export async function recomputeAgentRankings(period: keyof typeof PERIOD_DAYS = "30d") {
  const sb = await getAdmin();
  const since = new Date(Date.now() - PERIOD_DAYS[period] * 86400_000).toISOString();
  const { data: agents } = await sb.from("agents").select("id, name");
  if (!agents) return [];
  const results: Array<Record<string, unknown>> = [];
  for (const a of agents) {
    const { data: votes } = await sb
      .from("agent_votes")
      .select("vote, confidence, voted_at")
      .eq("agent_id", a.id)
      .gte("voted_at", since);
    const trades = votes?.length ?? 0;
    const avgConf = trades ? votes!.reduce((s: number, v: any) => s + Number(v.confidence ?? 0), 0) / trades : 0;
    const { data: hist } = await sb
      .from("agent_performance_history")
      .select("hit_rate, profit_simulated, drawdown_caused, good_votes, bad_votes, score")
      .eq("agent_id", a.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    const accuracy = avgNum(hist, "hit_rate");
    const profit = avgNum(hist, "profit_simulated");
    const dd = avgNum(hist, "drawdown_caused");
    const histScore = avgNum(hist, "score");
    const good = sumNum(hist, "good_votes");
    const bad = sumNum(hist, "bad_votes");
    const veto = good + bad > 0 ? good / (good + bad) : null;
    const consistency = avgConf;
    const score = clamp(
      (accuracy ?? 0.5) * 35 +
      Math.max(0, Math.min(1, (profit ?? 0))) * 25 +
      (1 - Math.min(1, dd ?? 0)) * 15 +
      consistency * 10 +
      (veto ?? 0.5) * 8 +
      ((histScore ?? 0) / 100) * 7,
      0,
      100
    );
    const row = {
      agent_id: a.id,
      period,
      score,
      accuracy,
      profit_contribution: profit,
      drawdown_caused: dd,
      consistency,
      veto_precision: veto,
      justification_quality: avgConf,
      trades_count: trades,
      computed_at: new Date().toISOString(),
    };
    await sb.from("agent_rankings").upsert(row, { onConflict: "agent_id,period" });
    results.push(row);
  }
  return results;
}

function avgNum(rows: any[] | null | undefined, key: string): number | null {
  if (!rows || rows.length === 0) return null;
  const nums = rows.map((r) => Number(r[key])).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function sumNum(rows: any[] | null | undefined, key: string): number {
  if (!rows) return 0;
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ---------- Seasonal Performance ----------

export async function recomputeSeasonalPerformance() {
  const sb = await getAdmin();
  const periods: Array<keyof typeof PERIOD_DAYS> = ["30d", "90d", "180d", "365d"];
  const results: unknown[] = [];
  for (const period of periods) {
    const since = new Date(Date.now() - PERIOD_DAYS[period] * 86400_000).toISOString();
    const { data: trades } = await sb
      .from("automated_trades")
      .select("pnl, status")
      .gte("opened_at", since);
    const closed = ((trades as any[]) ?? []).filter((t) => t.status === "closed");
    const wins = closed.filter((t) => Number(t.pnl ?? 0) > 0);
    const losses = closed.filter((t) => Number(t.pnl ?? 0) < 0);
    const net = closed.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
    const winSum = wins.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
    const lossSum = Math.abs(losses.reduce((s, t) => s + Number(t.pnl ?? 0), 0)) || 1;
    const pf = winSum / lossSum;
    const wr = closed.length ? wins.length / closed.length : 0;
    const row = {
      period,
      trades_count: closed.length,
      net_pnl: net,
      win_rate: wr,
      profit_factor: pf,
      drawdown: null,
      metrics: { wins: wins.length, losses: losses.length } as any,
      computed_at: new Date().toISOString(),
    };
    await sb.from("seasonal_performance").insert(row);
    results.push(row);
  }
  return results;
}

// ---------- Post-Trade Analysis ----------

export async function generatePostTradeReport(automatedTradeId: string) {
  const sb = await getAdmin();
  const { data: trade, error } = await sb
    .from("automated_trades")
    .select("*")
    .eq("id", automatedTradeId)
    .single();
  if (error || !trade) throw new Error(error?.message ?? "trade not found");
  const { data: audits } = await sb
    .from("automated_trade_audits")
    .select("phase, summary, content")
    .eq("automated_trade_id", automatedTradeId);
  const { data: supervisor } = await sb
    .from("supervisor_reviews")
    .select("verdict, justification, anomalies")
    .eq("automated_trade_id", automatedTradeId)
    .maybeSingle();

  const userPrompt = `Analise a operação encerrada e produza JSON com:
- summary: resumo executivo (3-5 linhas)
- technical_analysis: o que funcionou / não funcionou na análise técnica
- risk_analysis: o que deu errado em termos de risco (ou correto)
- agent_evaluation: objeto { contributors: string[], blockers: string[] }
- recommendations: 3 melhorias concretas

Dados:
${JSON.stringify({ trade, audits, supervisor }).slice(0, 6000)}`;

  type Out = {
    summary: string;
    technical_analysis: string;
    risk_analysis: string;
    agent_evaluation: { contributors: string[]; blockers: string[] };
    recommendations: string[];
  };
  let out: Out;
  try {
    out = await chat<Out>({
      user: userPrompt,
      system: "Você é um auditor sênior de trading. Responda em português, JSON estrito.",
      jsonSchema: {
        name: "post_trade",
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            technical_analysis: { type: "string" },
            risk_analysis: { type: "string" },
            agent_evaluation: {
              type: "object",
              properties: {
                contributors: { type: "array", items: { type: "string" } },
                blockers: { type: "array", items: { type: "string" } },
              },
            },
            recommendations: { type: "array", items: { type: "string" } },
          },
        },
      },
    });
  } catch {
    out = {
      summary: `Operação ${trade.side} ${trade.asset_id} encerrada com PnL ${trade.pnl ?? 0}.`,
      technical_analysis: "Análise indisponível (IA offline).",
      risk_analysis: "Análise indisponível (IA offline).",
      agent_evaluation: { contributors: [], blockers: [] },
      recommendations: ["Aguardar análise quando IA voltar a responder."],
    };
  }

  const { data: report } = await sb
    .from("intelligence_reports")
    .insert({
      kind: "post_trade",
      trade_ref: automatedTradeId,
      title: `Pós-operação ${trade.side} ${trade.asset_id ?? ""}`.trim(),
      summary: out.summary,
      content: `${out.summary}\n\n## Técnico\n${out.technical_analysis}\n\n## Risco\n${out.risk_analysis}\n\n## Recomendações\n- ${out.recommendations.join("\n- ")}`,
      technical_analysis: out.technical_analysis,
      risk_analysis: out.risk_analysis,
      agent_evaluation: out.agent_evaluation as any,
      recommendations: out.recommendations.join("\n"),
      metadata: { trade_pnl: trade.pnl } as any,
    })
    .select("id")
    .single();

  await ingestMemory({
    kind: Number(trade.pnl ?? 0) >= 0 ? "success_pattern" : "failure_pattern",
    asset_id: trade.asset_id,
    ref_table: "automated_trades",
    ref_id: automatedTradeId,
    title: `Pós-operação ${trade.side} ${trade.asset_id ?? ""}`.trim(),
    content: `${out.summary}\n${out.technical_analysis}\n${out.risk_analysis}`,
    metadata: { pnl: trade.pnl, recommendations: out.recommendations },
  }).catch((e) => console.warn("memory ingest failed", e));

  return report?.id ?? null;
}

// ---------- Learning Recommendations ----------

export async function proposeRecommendation(input: {
  kind: string;
  title: string;
  description: string;
  rationale?: string;
  suggested_changes: Record<string, unknown>;
  expected_impact?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}) {
  const sb = await getAdmin();
  const { data, error } = await sb
    .from("learning_recommendations")
    .insert({
      kind: input.kind,
      title: input.title,
      description: input.description,
      rationale: input.rationale ?? null,
      suggested_changes: (input.suggested_changes ?? {}) as any,
      expected_impact: (input.expected_impact ?? {}) as any,
      evidence: (input.evidence ?? {}) as any,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function generateRecommendationsFromHistory() {
  const sb = await getAdmin();
  const { data: rankings } = await sb
    .from("agent_rankings")
    .select("agent_id, period, score, accuracy")
    .eq("period", "30d")
    .order("score", { ascending: true })
    .limit(5);
  const created: string[] = [];
  for (const r of (rankings as any[]) ?? []) {
    if (Number(r.score) < 40) {
      const id = await proposeRecommendation({
        kind: "agent_weight",
        title: `Reduzir peso do agente ${r.agent_id} (score ${Number(r.score).toFixed(1)})`,
        description: `O agente está performando abaixo do esperado nos últimos 30 dias.`,
        rationale: `Score 30d=${Number(r.score).toFixed(1)} | accuracy=${r.accuracy ?? "n/d"}`,
        suggested_changes: { agent_id: r.agent_id, weight_delta: -0.2 },
        expected_impact: { confidence_change: "leve melhora esperada" },
        evidence: r as Record<string, unknown>,
      });
      created.push(id);
    }
  }
  return created;
}

// ---------- Opportunity Radar ----------

export async function recomputeOpportunityRadar() {
  const sb = await getAdmin();
  await sb.from("opportunity_radar").delete().lt("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
  const { data: assets } = await sb.from("monitored_assets").select("id, pair, active").eq("active", true);
  const created: unknown[] = [];
  for (const a of (assets as any[]) ?? []) {
    const { data: candles } = await sb
      .from("candles")
      .select("close, open_time")
      .eq("pair", a.pair)
      .order("open_time", { ascending: false })
      .limit(50);
    const list = ((candles as any[]) ?? []).slice().reverse();
    if (list.length < 20) continue;
    const r = await detectRegimeFromCandles(list);
    let kind: string | null = null;
    let reason = "";
    if (r.regime === "high_volatility") { kind = "dangerous"; reason = `Volatilidade elevada (${(r.volatility * 100).toFixed(2)}%)`; }
    else if (r.regime === "bull" && r.confidence > 0.6) { kind = "promising"; reason = `Tendência de alta (força ${r.trend_strength.toFixed(2)})`; }
    else if (r.regime === "bear" && r.confidence > 0.6) { kind = "dangerous"; reason = `Tendência de baixa (força ${r.trend_strength.toFixed(2)})`; }
    if (kind) {
      const { data } = await sb.from("opportunity_radar").insert({
        asset_id: a.id,
        symbol: a.pair,
        kind,
        score: r.confidence * 100,
        reason,
        metadata: r as any,
      }).select("id").single();
      created.push(data);
    }
  }
  return created;
}

// ---------- Strategy Laboratory: simulation ----------

export async function simulateStrategy(labId: string, params: Record<string, unknown>) {
  const sb = await getAdmin();
  const { data: lab } = await sb.from("strategy_laboratory").select("*").eq("id", labId).single();
  if (!lab) throw new Error("lab not found");

  const { data: trades } = await sb
    .from("automated_trades")
    .select("pnl")
    .eq("status", "closed")
    .order("opened_at", { ascending: false })
    .limit(200);
  const base = ((trades as any[]) ?? []).map((t) => Number(t.pnl ?? 0));
  const weightAdj = Number(params.weight_multiplier ?? 1);
  const scoreFloor = Number(params.min_score ?? 0);
  const filtered = base.filter((_, i) => i % Math.max(1, Math.round(1 + scoreFloor / 30)) === 0);
  const adjusted = filtered.map((p) => p * weightAdj);
  const net = adjusted.reduce((a, b) => a + b, 0);
  const wins = adjusted.filter((p) => p > 0).length;
  const wr = adjusted.length ? wins / adjusted.length : 0;
  let peak = 0, trough = 0, dd = 0, run = 0;
  for (const p of adjusted) { run += p; if (run > peak) { peak = run; trough = run; } if (run < trough) { trough = run; dd = Math.max(dd, peak - trough); } }
  const score = clamp(net * 0.4 + wr * 60 - dd * 0.2, -50, 100);

  const { data: sim } = await sb.from("strategy_simulations").insert({
    lab_id: labId,
    params: params as any,
    results: { sample: adjusted.length, net, win_rate: wr, drawdown: dd } as any,
    expected_pnl: net,
    expected_drawdown: dd,
    expected_winrate: wr,
    score,
    notes: `Simulação rápida sobre ${adjusted.length} trades históricos.`,
  }).select("id, score, expected_pnl, expected_drawdown, expected_winrate").single();
  return sim;
}
