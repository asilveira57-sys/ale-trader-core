// Robot Confidence Index — composite 0..100.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConfidenceComponents {
  score: number;
  accuracy_component: number;
  performance_component: number;
  drawdown_component: number;
  agents_precision_component: number;
  data_quality_component: number;
}

export async function computeConfidence(supabase: SupabaseClient): Promise<ConfidenceComponents> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: closedReal }, { data: closedSim }, { data: agents }, { data: candle }] = await Promise.all([
    supabase.from("real_positions").select("pnl, pnl_pct").eq("status", "closed").gte("closed_at", since),
    supabase.from("live_simulated_positions").select("pnl, pnl_pct").eq("status", "closed").gte("closed_at", since),
    supabase.from("agent_reputation").select("score, hits, misses"),
    supabase.from("candles").select("ts").order("ts", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const all = [...(closedReal ?? []), ...(closedSim ?? [])];
  const wins = all.filter((p: any) => Number(p.pnl ?? 0) > 0).length;
  const accuracy = all.length ? (wins / all.length) * 100 : 50;

  const sumPnl = all.reduce((s: number, p: any) => s + Number(p.pnl ?? 0), 0);
  const performance = Math.max(0, Math.min(100, 50 + sumPnl));

  let peak = 0, equity = 0, maxDd = 0;
  for (const p of all) {
    equity += Number(p.pnl ?? 0);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  const drawdown = Math.max(0, 100 - maxDd);

  const repList = (agents ?? []).map((a: any) => Number(a.score ?? 50));
  const agentsPrec = repList.length ? repList.reduce((s, v) => s + v, 0) / repList.length : 50;

  let dq = 100;
  if (!candle) dq = 30;
  else {
    const ageMin = (Date.now() - new Date(candle.ts).getTime()) / 60000;
    if (ageMin > 60) dq = 40;
    else if (ageMin > 15) dq = 70;
  }

  const score = Math.round(accuracy * 0.25 + performance * 0.2 + drawdown * 0.2 + agentsPrec * 0.25 + dq * 0.1);
  const components: ConfidenceComponents = {
    score,
    accuracy_component: Math.round(accuracy),
    performance_component: Math.round(performance),
    drawdown_component: Math.round(drawdown),
    agents_precision_component: Math.round(agentsPrec),
    data_quality_component: Math.round(dq),
  };

  await supabase.from("robot_confidence").insert(components);
  return components;
}

export async function getLatestConfidence(supabase: SupabaseClient): Promise<ConfidenceComponents | null> {
  const { data } = await supabase.from("robot_confidence").select("*").order("computed_at", { ascending: false }).limit(1).maybeSingle();
  return data as any;
}
