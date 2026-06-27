// Server functions do Cérebro Binance — auditoria, score e ranking.
// Não altera o pipeline de execução. Apenas registra análises e gera relatórios.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FLEX_SAMPLE_THRESHOLD = 300;

export const runBrainAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol: string; side?: "buy" | "sell"; notional?: number; persist?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { analyzeBrain } = await import("./binance-brain.server");
    const analysis = await analyzeBrain(data.symbol, { side: data.side, notional: data.notional });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("binance_brain_audit")
      .select("id", { count: "exact", head: true });
    const sample = count ?? 0;
    const flexMode = sample < FLEX_SAMPLE_THRESHOLD;

    if (data.persist !== false) {
      const votesObj: Record<string, { vote: string; detail: string; value?: number }> = {};
      for (const v of analysis.indicators) votesObj[v.indicator] = { vote: v.vote, detail: v.detail, value: v.value };

      const row = {
        symbol: analysis.symbol,
        side: analysis.side,
        price: analysis.price,
        notional: data.notional ?? null,
        trend_1m: analysis.timeframes.find((t) => t.tf === "1m")?.trend ?? null,
        trend_5m: analysis.timeframes.find((t) => t.tf === "5m")?.trend ?? null,
        trend_15m: analysis.timeframes.find((t) => t.tf === "15m")?.trend ?? null,
        trend_1h: analysis.timeframes.find((t) => t.tf === "1h")?.trend ?? null,
        trend_4h: analysis.timeframes.find((t) => t.tf === "4h")?.trend ?? null,
        trend_1d: analysis.timeframes.find((t) => t.tf === "1d")?.trend ?? null,
        trend_7d: analysis.timeframes.find((t) => t.tf === "7d")?.trend ?? null,
        trend_15d: analysis.timeframes.find((t) => t.tf === "15d")?.trend ?? null,
        trend_30d: analysis.timeframes.find((t) => t.tf === "30d")?.trend ?? null,
        dominant_trend: analysis.dominantTrend,
        timeframe_conflict: analysis.timeframeConflict,
        indicator_votes: votesObj,
        approve_count: analysis.approve,
        reject_count: analysis.reject,
        neutral_count: analysis.neutral,
        score: analysis.score,
        classification: analysis.classification,
        fee_buy: analysis.feeBuy,
        fee_sell: analysis.feeSell,
        spread_pct: analysis.spreadPct,
        slippage_pct: analysis.slippagePct,
        expected_gross: analysis.expectedGross,
        expected_net: analysis.expectedNet,
        fee_gate_passed: analysis.feeGatePassed,
        volatility_class: analysis.volatilityClass,
        volume_signal: analysis.volumeSignal,
        fib_levels: analysis.fibLevels,
        rationale: analysis.rationale,
        brain_recommendation: analysis.recommendation,
        flex_mode: flexMode,
        sample_size: sample,
      };
      await supabaseAdmin.from("binance_brain_audit").insert(row);

      // Atualiza performance acumulada (votos totais por indicador)
      for (const v of analysis.indicators) {
        const { data: existing } = await supabaseAdmin
          .from("binance_indicator_performance")
          .select("*")
          .eq("indicator", v.indicator)
          .maybeSingle();
        if (!existing) {
          await supabaseAdmin.from("binance_indicator_performance").insert({
            indicator: v.indicator,
            votes_total: 1,
            votes_approve: v.vote === "approve" ? 1 : 0,
            votes_reject: v.vote === "reject" ? 1 : 0,
          });
        } else {
          await supabaseAdmin
            .from("binance_indicator_performance")
            .update({
              votes_total: (existing.votes_total ?? 0) + 1,
              votes_approve: (existing.votes_approve ?? 0) + (v.vote === "approve" ? 1 : 0),
              votes_reject: (existing.votes_reject ?? 0) + (v.vote === "reject" ? 1 : 0),
              last_updated: new Date().toISOString(),
            })
            .eq("id", existing.id);
        }
      }
    }

    return { analysis, flexMode, sample };
  });

export const getBrainReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { hours?: number } = {}) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hours = data.hours ?? 24;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const { data: audits = [] } = await supabaseAdmin
      .from("binance_brain_audit")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    const list = audits ?? [];
    const total = list.length;
    const approved = list.filter((r) => r.fee_gate_passed && r.score >= 51).length;
    const rejected = total - approved;
    const avgScore = total ? list.reduce((a, r) => a + Number(r.score ?? 0), 0) / total : 0;
    const sumGross = list.reduce((a, r) => a + Number(r.expected_gross ?? 0), 0);
    const sumNet = list.reduce((a, r) => a + Number(r.expected_net ?? 0), 0);
    const sumFees = list.reduce((a, r) => a + Number(r.fee_buy ?? 0) + Number(r.fee_sell ?? 0), 0);

    const byReason = new Map<string, number>();
    for (const r of list) {
      if (r.fee_gate_passed && Number(r.score) >= 51) continue;
      const reason = !r.fee_gate_passed
        ? "Bloqueado por taxas (lucro < 3x custo)"
        : Number(r.score) <= 30
        ? "Score muito baixo"
        : Number(r.score) <= 50
        ? "Muito arriscado"
        : r.timeframe_conflict
        ? "Conflito multitemporal"
        : "Sem consenso";
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }

    const { data: perf = [] } = await supabaseAdmin
      .from("binance_indicator_performance")
      .select("*")
      .order("votes_total", { ascending: false });

    return {
      since,
      total,
      approved,
      rejected,
      avgScore,
      sumGross,
      sumNet,
      sumFees,
      rejectionReasons: Array.from(byReason.entries()).map(([reason, count]) => ({ reason, count })),
      indicators: perf ?? [],
      recent: list.slice(0, 50),
    };
  });

export const listBrainSymbols = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("monitored_assets")
      .select("pair")
      .eq("active", true);
    const fallback = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
    const got = (data ?? []).map((d) => (d.pair ?? "").replace("/", "").toUpperCase()).filter(Boolean);
    return got.length ? got : fallback;
  });

// Fase 2B — autoauditoria e feedback manual
export const runSelfAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { hours?: number } = {}) => d)
  .handler(async ({ data }) => {
    const { runBrainSelfAudit } = await import("./binance-brain-feedback.server");
    return runBrainSelfAudit(data.hours ?? 24);
  });

export const replayClosedTradesFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { hours?: number } = {}) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { applyBrainFeedbackForDecision } = await import("./binance-brain-feedback.server");
    const since = new Date(Date.now() - (data.hours ?? 168) * 3600 * 1000).toISOString();
    const { data: orders } = await supabaseAdmin
      .from("simulated_orders")
      .select("decision_id, net_pnl, side, status")
      .eq("status", "closed")
      .eq("side", "buy")
      .gte("closed_at", since)
      .not("decision_id", "is", null);
    let processed = 0, matched = 0;
    for (const o of orders ?? []) {
      const r = await applyBrainFeedbackForDecision(o.decision_id as string, Number(o.net_pnl ?? 0));
      processed++;
      matched += r.matched;
    }
    return { processed, matchedAudits: matched };
  });
