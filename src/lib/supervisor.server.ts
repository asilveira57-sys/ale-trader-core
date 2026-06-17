// Independent supervisor for Phase 7 automated production.
// Validates committee decisions before any order is executed.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupervisorInput {
  requestId: string;
  pair: string;
  side: "buy" | "sell";
  price: number;
  stop: number;
  take: number;
  score: number;
  consensus: number;
  votesFor: number;
  votesAgainst: number;
  vetoes: string[];
}

export interface SupervisorReview {
  verdict: "approved" | "warning" | "blocked";
  checks: Record<string, boolean>;
  anomalies: string[];
  data_quality_score: number;
  justification: string;
}

export async function runSupervisor(
  supabase: SupabaseClient,
  input: SupervisorInput,
): Promise<SupervisorReview> {
  const { data: gov } = await supabase.from("governance_settings").select("*").limit(1).maybeSingle();
  const minScore = Number(gov?.min_score_for_auto ?? 75);
  const minConsensus = Number(gov?.min_consensus_for_auto ?? 0.7);
  const minRR = Number(gov?.min_risk_reward ?? 1.5);

  const risk = Math.abs(input.price - input.stop);
  const reward = Math.abs(input.take - input.price);
  const rr = risk > 0 ? reward / risk : 0;

  const checks: Record<string, boolean> = {
    has_stop: input.stop > 0,
    has_take: input.take > 0,
    score_ok: input.score >= minScore,
    consensus_ok: input.consensus >= minConsensus,
    risk_reward_ok: rr >= minRR,
    no_critical_veto: !(input.vetoes ?? []).some((v) => /risco|euforia|anti/i.test(v)),
    coherent_direction: input.side === "buy" ? input.take > input.price && input.stop < input.price : input.take < input.price && input.stop > input.price,
  };

  // Data quality — look for recent candle and price coherence.
  const { data: lastCandle } = await supabase
    .from("candles").select("close, ts")
    .eq("pair", input.pair).order("ts", { ascending: false }).limit(1).maybeSingle();
  const anomalies: string[] = [];
  let dq = 100;
  if (!lastCandle) { anomalies.push("Sem candle recente"); dq -= 30; }
  else {
    const ageMin = (Date.now() - new Date(lastCandle.ts).getTime()) / 60000;
    if (ageMin > 15) { anomalies.push(`Candle desatualizado (${ageMin.toFixed(0)} min)`); dq -= 20; }
    const drift = Math.abs(Number(lastCandle.close) - input.price) / input.price;
    if (drift > 0.02) { anomalies.push(`Drift de preço ${(drift * 100).toFixed(2)}%`); dq -= 25; }
  }
  checks.data_quality_ok = dq >= 60;

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const verdict: SupervisorReview["verdict"] = failed.length === 0 ? "approved" : failed.length <= 1 ? "warning" : "blocked";
  const justification = failed.length === 0
    ? "Decisão coerente com todos os critérios do supervisor."
    : `Falhas: ${failed.join(", ")}. ${anomalies.join("; ")}`.trim();

  const { data: review } = await supabase.from("supervisor_reviews").insert({
    request_id: input.requestId,
    verdict, checks, anomalies, data_quality_score: dq, justification,
  }).select().single();

  return { verdict, checks, anomalies, data_quality_score: dq, justification };
}
