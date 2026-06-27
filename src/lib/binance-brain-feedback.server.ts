// Fase 2B — feedback pós-trade + autoauditoria do Cérebro Binance.
// Server-only. Atualiza hits/misses/hit_rate/weight em binance_indicator_performance.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MIN_W = 0.3;
const MAX_W = 2.0;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Política de aprendizado: aprova + lucro = hit; reprova + prejuízo = hit; neutro = ignorado.
function judge(vote: string, netPnl: number): "hit" | "miss" | "skip" {
  if (vote === "neutral") return "skip";
  const profitable = netPnl > 0;
  if (vote === "approve") return profitable ? "hit" : "miss";
  if (vote === "reject") return profitable ? "miss" : "hit";
  return "skip";
}

export async function applyBrainFeedbackForDecision(decisionId: string, netPnl: number) {
  if (!decisionId) return { matched: 0 };
  const { data: audits } = await supabaseAdmin
    .from("binance_brain_audit")
    .select("id, indicator_votes")
    .eq("related_decision_id", decisionId);

  if (!audits?.length) return { matched: 0 };

  const aggregate = new Map<string, { hits: number; misses: number }>();
  for (const a of audits) {
    const votes = (a.indicator_votes ?? {}) as Record<string, { vote: string }>;
    for (const [indicator, payload] of Object.entries(votes)) {
      const verdict = judge(payload.vote, netPnl);
      if (verdict === "skip") continue;
      const cur = aggregate.get(indicator) ?? { hits: 0, misses: 0 };
      if (verdict === "hit") cur.hits++; else cur.misses++;
      aggregate.set(indicator, cur);
    }
  }

  for (const [indicator, delta] of aggregate.entries()) {
    const { data: existing } = await supabaseAdmin
      .from("binance_indicator_performance")
      .select("*")
      .eq("indicator", indicator)
      .maybeSingle();
    const hits = Number(existing?.hits ?? 0) + delta.hits;
    const misses = Number(existing?.misses ?? 0) + delta.misses;
    const total = hits + misses;
    const hitRate = total > 0 ? hits / total : 0;
    // peso 1.0 = 50% accuracy; sobe linearmente. Mantém peso mínimo pra não silenciar indicadores em aprendizado.
    const weight = clamp(0.5 + hitRate, MIN_W, MAX_W);
    if (existing) {
      await supabaseAdmin
        .from("binance_indicator_performance")
        .update({ hits, misses, hit_rate: hitRate, weight, last_updated: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("binance_indicator_performance").insert({
        indicator, votes_total: total, hits, misses, hit_rate: hitRate, weight,
      });
    }
  }

  return { matched: audits.length, indicators: aggregate.size };
}

export interface SelfAuditReport {
  windowHours: number;
  totalAnalyses: number;
  totalFeedback: number;
  bestIndicators: Array<{ indicator: string; hit_rate: number; weight: number; samples: number }>;
  worstIndicators: Array<{ indicator: string; hit_rate: number; weight: number; samples: number }>;
  suggestions: string[];
  generatedAt: string;
}

export async function runBrainSelfAudit(hours = 24): Promise<SelfAuditReport> {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { count: totalAnalyses } = await supabaseAdmin
    .from("binance_brain_audit")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  const { data: perf } = await supabaseAdmin
    .from("binance_indicator_performance")
    .select("*");

  const rows = (perf ?? []).map((r) => ({
    indicator: r.indicator,
    hit_rate: Number(r.hit_rate ?? 0),
    weight: Number(r.weight ?? 1.0),
    samples: Number(r.hits ?? 0) + Number(r.misses ?? 0),
  }));
  const totalFeedback = rows.reduce((a, r) => a + r.samples, 0);

  const matured = rows.filter((r) => r.samples >= 5);
  const ranked = [...matured].sort((a, b) => b.hit_rate - a.hit_rate);
  const bestIndicators = ranked.slice(0, 5);
  const worstIndicators = ranked.slice(-5).reverse();

  const suggestions: string[] = [];
  for (const r of matured) {
    if (r.hit_rate < 0.4 && r.weight > 0.5) {
      suggestions.push(`Reduzir peso de "${r.indicator}" — accuracy ${(r.hit_rate * 100).toFixed(0)}% em ${r.samples} amostras.`);
    }
    if (r.hit_rate > 0.7 && r.weight < 1.5) {
      suggestions.push(`Promover "${r.indicator}" — accuracy ${(r.hit_rate * 100).toFixed(0)}% em ${r.samples} amostras.`);
    }
  }
  if (!matured.length) suggestions.push("Sem indicadores maduros ainda (mínimo 5 trades fechados). Continue operando para o cérebro aprender.");

  const report: SelfAuditReport = {
    windowHours: hours,
    totalAnalyses: totalAnalyses ?? 0,
    totalFeedback,
    bestIndicators,
    worstIndicators,
    suggestions,
    generatedAt: new Date().toISOString(),
  };

  await supabaseAdmin.from("system_logs").insert({
    category: "Cérebro",
    pair: null,
    message: `[autoauditoria] ${report.totalAnalyses} análises / ${report.totalFeedback} feedbacks · ${suggestions.length} sugestões`,
    level: "info",
    details: report as any,
  });

  return report;
}
