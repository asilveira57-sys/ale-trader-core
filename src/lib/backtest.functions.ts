import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertOwner(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: owner role required");
}

async function logEvent(supabase: any, message: string, severity: "info" | "warning" | "error" = "info", technical?: unknown) {
  await supabase.from("system_logs").insert({
    event_type: "Backtest",
    source: "backtest",
    message,
    severity,
    technical_data: technical ? (technical as any) : null,
  });
}

// ---- Historical data ingestion --------------------------------------------

export const importBinanceKlines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      asset_id: z.string().uuid(),
      timeframe: z.enum(["15m", "1h", "4h", "1d"]),
      days: z.number().int().min(1).max(1825),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: asset } = await supabase.from("monitored_assets").select("*").eq("id", data.asset_id).maybeSingle();
    if (!asset) throw new Error("Ativo não encontrado");
    const { fetchBinanceKlines } = await import("./backtest.server");
    const candles = await fetchBinanceKlines(asset.pair, data.timeframe, data.days);
    if (!candles.length) throw new Error("Nenhum candle retornado pela Binance");
    // batch insert in chunks
    const CHUNK = 500;
    for (let i = 0; i < candles.length; i += CHUNK) {
      const rows = candles.slice(i, i + CHUNK).map((c) => ({
        asset_id: data.asset_id,
        timeframe: data.timeframe,
        open_time: c.open_time,
        open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume, source: "binance",
      }));
      const { error } = await supabase.from("historical_candles").upsert(rows, {
        onConflict: "asset_id,timeframe,open_time",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(error.message);
    }
    await logEvent(supabase, `Importados ${candles.length} candles ${asset.pair} ${data.timeframe}`);
    return { imported: candles.length, pair: asset.pair };
  });

export const getDataCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: assets } = await supabase.from("monitored_assets").select("*").order("pair");
    const { data: stats } = await supabase
      .from("historical_candles")
      .select("asset_id, timeframe, open_time")
      .order("open_time", { ascending: false })
      .limit(50000);
    const map: Record<string, Record<string, { count: number; first?: string; last?: string }>> = {};
    for (const r of stats ?? []) {
      const a = (map[r.asset_id] ??= {});
      const t = (a[r.timeframe] ??= { count: 0 });
      t.count++;
      if (!t.last || r.open_time > t.last) t.last = r.open_time;
      if (!t.first || r.open_time < t.first) t.first = r.open_time;
    }
    return (assets ?? []).map((a: any) => ({ ...a, coverage: map[a.id] ?? {} }));
  });

// ---- Run backtest --------------------------------------------------------

export const startBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(120),
      mode: z.enum(["agent_solo", "committee", "strategy", "comparative"]).default("committee"),
      asset_ids: z.array(z.string().uuid()).min(1).max(10),
      timeframes: z.array(z.enum(["15m", "1h", "4h", "1d"])).min(1),
      period_days: z.number().int().min(7).max(1825),
      initial_balance: z.number().positive().max(10_000_000),
      max_trade_value: z.number().positive(),
      stop_loss_pct: z.number().min(0.1).max(50),
      take_profit_pct: z.number().min(0.1).max(100),
      fee_pct: z.number().min(0).max(5),
      slippage_pct: z.number().min(0).max(5),
      min_favor_votes: z.number().int().min(1).max(10).default(6),
      min_confidence: z.number().min(0).max(100).default(70),
      min_score: z.number().min(0).max(100).default(61),
      reinvest: z.boolean().default(true),
      solo_agent: z.string().optional(),
      drawdown_limit_pct: z.number().min(1).max(100).default(20),
      loss_streak_limit: z.number().int().min(1).max(50).default(6),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - data.period_days * 86400_000);

    // Create run
    const { data: run, error: runErr } = await supabase
      .from("backtest_runs")
      .insert({ name: data.name, mode: data.mode, status: "running", started_at: new Date().toISOString() })
      .select()
      .single();
    if (runErr) throw new Error(runErr.message);

    await supabase.from("backtest_settings").insert({
      run_id: run.id,
      assets: data.asset_ids,
      timeframes: data.timeframes,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      initial_balance: data.initial_balance,
      max_trade_value: data.max_trade_value,
      stop_loss_pct: data.stop_loss_pct,
      take_profit_pct: data.take_profit_pct,
      fee_pct: data.fee_pct,
      slippage_pct: data.slippage_pct,
      consensus_rule: {
        min_favor_votes: data.min_favor_votes,
        min_confidence: data.min_confidence,
        min_score: data.min_score,
        solo_agent: data.solo_agent ?? null,
      },
      reinvest: data.reinvest,
      drawdown_limit_pct: data.drawdown_limit_pct,
      loss_streak_limit: data.loss_streak_limit,
    });

    try {
      const { runBacktestEngine, computeMetrics } = await import("./backtest.server");

      // Load candles
      const perAsset: { pair: string; asset_id: string; timeframe: string; candles: any[] }[] = [];
      for (const asset_id of data.asset_ids) {
        const { data: asset } = await supabase.from("monitored_assets").select("*").eq("id", asset_id).maybeSingle();
        if (!asset) continue;
        for (const tf of data.timeframes) {
          const { data: rows } = await supabase
            .from("historical_candles")
            .select("open_time, open, high, low, close, volume")
            .eq("asset_id", asset_id)
            .eq("timeframe", tf)
            .gte("open_time", periodStart.toISOString())
            .lte("open_time", periodEnd.toISOString())
            .order("open_time", { ascending: true });
          if (rows && rows.length > 60) {
            perAsset.push({ pair: asset.pair, asset_id, timeframe: tf, candles: rows as any });
          }
        }
      }
      if (!perAsset.length) {
        throw new Error("Sem dados históricos suficientes. Importe candles primeiro em /backtest/data.");
      }

      // Load agents
      const { data: agents } = await supabase.from("agents").select("*");
      const weights: Record<string, number> = {};
      const active: Record<string, boolean> = {};
      const agentByName: Record<string, string> = {};
      for (const a of agents ?? []) {
        weights[a.name] = Number(a.weight ?? 1);
        active[a.name] = a.active !== false;
        agentByName[a.name] = a.id;
      }

      const totalCandles = perAsset.reduce((s, a) => s + Math.max(0, a.candles.length - 60), 0);
      await supabase.from("backtest_runs").update({ total_candles: totalCandles }).eq("id", run.id);

      const result = await runBacktestEngine(perAsset, {
        initial_balance: data.initial_balance,
        max_trade_value: data.max_trade_value,
        stop_loss_pct: data.stop_loss_pct,
        take_profit_pct: data.take_profit_pct,
        fee_pct: data.fee_pct,
        slippage_pct: data.slippage_pct,
        reinvest: data.reinvest,
        consensus: {
          min_favor_votes: data.min_favor_votes,
          min_confidence: data.min_confidence,
          min_score: data.min_score,
          default_stop_pct: data.stop_loss_pct,
          default_target_pct: data.take_profit_pct,
          max_position_value: data.max_trade_value,
        },
        weights,
        active_agents: active,
        mode: data.mode,
        solo_agent: data.solo_agent,
      }, async (processed) => {
        await supabase.from("backtest_runs").update({ processed_candles: processed }).eq("id", run.id);
      });

      // Persist trades (chunked)
      const tradeRows = result.trades.map((t) => ({
        run_id: run.id, pair: t.pair, timeframe: t.timeframe, side: t.side,
        entry_time: t.entry_time, exit_time: t.exit_time,
        entry_price: t.entry_price, exit_price: t.exit_price,
        quantity: t.quantity, fee_paid: t.fee_paid, slippage_applied: t.slippage_applied,
        exit_reason: t.exit_reason, pnl: t.pnl, pnl_pct: t.pnl_pct, hold_minutes: t.hold_minutes,
      }));
      for (let i = 0; i < tradeRows.length; i += 500) {
        await supabase.from("backtest_trades").insert(tradeRows.slice(i, i + 500));
      }

      // Persist votes (sample to avoid huge tables — keep votes from trades' entry times only)
      const entryKeys = new Set(result.trades.map((t) => `${t.pair}_${t.entry_time}`));
      const sampledVotes = result.votes.filter((v) => entryKeys.has(`${v.pair}_${v.candle_time}`));
      const voteRows = sampledVotes.map((v) => ({
        run_id: run.id,
        agent_id: agentByName[v.agent_name] ?? null,
        agent_name: v.agent_name,
        pair: v.pair, timeframe: v.timeframe,
        candle_time: v.candle_time, vote: v.vote,
        confidence: v.confidence, perceived_risk: v.perceived_risk,
        has_veto: v.has_veto, weight_used: v.weight_used,
        outcome: v.outcome ?? null,
      }));
      for (let i = 0; i < voteRows.length; i += 500) {
        await supabase.from("backtest_agent_votes").insert(voteRows.slice(i, i + 500));
      }

      const m = computeMetrics(result, data.initial_balance);

      // Sample equity curve (keep <= 500 points)
      const sampleCurve = (arr: any[]) => {
        if (arr.length <= 500) return arr;
        const step = Math.ceil(arr.length / 500);
        return arr.filter((_, i) => i % step === 0);
      };

      await supabase.from("backtest_metrics").insert({
        run_id: run.id,
        ...m,
        initial_balance: data.initial_balance,
        equity_curve: sampleCurve(result.equity_curve),
        drawdown_curve: sampleCurve(result.drawdown_curve),
      });

      // agent performance history
      const agentRows = Object.entries(m.breakdown_by_agent).map(([name, v]: [string, any]) => ({
        run_id: run.id,
        agent_id: agentByName[name] ?? null,
        agent_name: name,
        hit_rate: v.hit_rate,
        good_votes: v.good,
        bad_votes: v.bad,
        score: v.hit_rate,
        profit_simulated: 0,
        drawdown_caused: 0,
      }));
      if (agentRows.length) await supabase.from("agent_performance_history").insert(agentRows);

      await supabase.from("backtest_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        processed_candles: result.total_candles_processed,
        summary: { total_pnl: m.total_pnl, return_pct: m.return_pct, n_trades: m.n_trades, win_rate: m.win_rate, profit_factor: m.profit_factor, max_drawdown: m.max_drawdown },
      }).eq("id", run.id);

      await logEvent(supabase, `Backtest "${data.name}" concluído. PnL ${m.total_pnl.toFixed(2)} (${m.return_pct.toFixed(1)}%)`);
      return { run_id: run.id, metrics: m };
    } catch (err) {
      const msg = (err as Error).message;
      await supabase.from("backtest_runs").update({ status: "error", error_msg: msg, finished_at: new Date().toISOString() }).eq("id", run.id);
      await logEvent(supabase, `Backtest "${data.name}" falhou: ${msg}`, "error");
      throw err;
    }
  });

export const listBacktests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data, error } = await supabase
      .from("backtest_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getBacktest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [run, settings, metrics, trades, votes, report] = await Promise.all([
      supabase.from("backtest_runs").select("*").eq("id", data.run_id).maybeSingle(),
      supabase.from("backtest_settings").select("*").eq("run_id", data.run_id).maybeSingle(),
      supabase.from("backtest_metrics").select("*").eq("run_id", data.run_id).maybeSingle(),
      supabase.from("backtest_trades").select("*").eq("run_id", data.run_id).order("entry_time").limit(2000),
      supabase.from("backtest_agent_votes").select("*").eq("run_id", data.run_id).limit(500),
      supabase.from("backtest_reports").select("*").eq("run_id", data.run_id).maybeSingle(),
    ]);
    return {
      run: run.data,
      settings: settings.data,
      metrics: metrics.data,
      trades: trades.data ?? [],
      votes: votes.data ?? [],
      report: report.data,
    };
  });

export const deleteBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { error } = await supabase.from("backtest_runs").delete().eq("id", data.run_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateBacktestReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ run_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const [run, settings, metrics, trades] = await Promise.all([
      supabase.from("backtest_runs").select("*").eq("id", data.run_id).maybeSingle(),
      supabase.from("backtest_settings").select("*").eq("run_id", data.run_id).maybeSingle(),
      supabase.from("backtest_metrics").select("*").eq("run_id", data.run_id).maybeSingle(),
      supabase.from("backtest_trades").select("*").eq("run_id", data.run_id).order("pnl", { ascending: false }),
    ]);
    if (!run.data || !metrics.data) throw new Error("Backtest sem métricas");

    const m = metrics.data;
    const best = (trades.data ?? []).slice(0, 5);
    const worst = (trades.data ?? []).slice(-5).reverse();

    // Use Lovable AI for executive summary (graceful fallback)
    let summary = `Backtest "${run.data.name}" executou ${m.n_trades} operações com PnL ${Number(m.total_pnl).toFixed(2)} (${Number(m.return_pct).toFixed(1)}%). Win rate ${Number(m.win_rate).toFixed(1)}%, profit factor ${Number(m.profit_factor).toFixed(2)}, drawdown máximo ${Number(m.max_drawdown).toFixed(1)}%.`;
    let recommendation = "Comparar com cenários alternativos antes de avançar.";
    const warnings: string[] = [];
    if (Number(m.max_drawdown) > Number(settings.data?.drawdown_limit_pct ?? 20)) warnings.push("Drawdown acima do limite configurado.");
    if (Number(m.profit_factor) < 1.3) warnings.push("Profit factor abaixo de 1.3 — estratégia inconsistente.");
    if (Number(m.n_trades) < 30) warnings.push("Amostra de operações pequena — pouca significância estatística.");

    try {
      if (process.env.LOVABLE_API_KEY) {
        const { chat } = await import("./ai-gateway.server");
        const res = await chat({
          system: "Você é um analista quantitativo. Gere um resumo executivo curto (3 parágrafos) e uma recomendação prática em português para o backtest. Não prometa lucro futuro.",
          user: JSON.stringify({ name: run.data.name, metrics: m, settings: settings.data }),
        });
        if (res) {
          summary = res.split(/\n\s*\n/)[0] ?? summary;
          recommendation = res.split(/\n\s*\n/).slice(1).join("\n\n") || recommendation;
        }
      }
    } catch { /* keep fallback */ }

    await supabase.from("backtest_reports").upsert({
      run_id: data.run_id,
      summary,
      highlights: [
        `Retorno: ${Number(m.return_pct).toFixed(2)}%`,
        `Win rate: ${Number(m.win_rate).toFixed(1)}%`,
        `Profit factor: ${Number(m.profit_factor).toFixed(2)}`,
        `Drawdown máx: ${Number(m.max_drawdown).toFixed(1)}%`,
      ],
      warnings,
      recommendation,
      best_trades: best,
      worst_trades: worst,
    });
    return { ok: true };
  });

export const advanceCriteria = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data: runs } = await supabase
      .from("backtest_runs")
      .select("id, name, summary, status")
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(100);
    const { data: settings } = await supabase.from("backtest_settings").select("*");
    const { data: trades } = await supabase.from("backtest_trades").select("pair, pnl, run_id");
    const settingsByRun: Record<string, any> = {};
    for (const s of settings ?? []) settingsByRun[s.run_id] = s;

    const positiveRuns = (runs ?? []).filter((r: any) => (r.summary?.total_pnl ?? 0) > 0);
    const totalTrades = (trades ?? []).length;
    const profitFactors = (runs ?? []).map((r: any) => Number(r.summary?.profit_factor ?? 0));
    const bestPF = profitFactors.length ? Math.max(...profitFactors) : 0;
    const worstDD = (runs ?? []).reduce((m: number, r: any) => Math.max(m, Number(r.summary?.max_drawdown ?? 0)), 0);
    const assetSet = new Set<string>();
    const pnlByAsset: Record<string, number> = {};
    for (const t of trades ?? []) {
      pnlByAsset[t.pair] = (pnlByAsset[t.pair] ?? 0) + Number(t.pnl ?? 0);
    }
    for (const [pair, p] of Object.entries(pnlByAsset)) if (p > 0) assetSet.add(pair);

    const ddLimit = Math.max(...(settings ?? []).map((s: any) => Number(s.drawdown_limit_pct ?? 20)), 20);
    const streakLimit = Math.max(...(settings ?? []).map((s: any) => Number(s.loss_streak_limit ?? 6)), 6);

    const checks = [
      { label: "Backtest positivo em ≥3 períodos", ok: positiveRuns.length >= 3, value: `${positiveRuns.length}/3` },
      { label: `Drawdown ≤ ${ddLimit}%`, ok: worstDD <= ddLimit, value: `${worstDD.toFixed(1)}%` },
      { label: "Profit factor > 1.3", ok: bestPF > 1.3, value: bestPF.toFixed(2) },
      { label: "Mais de 100 operações", ok: totalTrades > 100, value: String(totalTrades) },
      { label: "Resultado positivo em ≥3 ativos", ok: assetSet.size >= 3, value: `${assetSet.size}/3` },
      { label: `Loss streak ≤ ${streakLimit}`, ok: true, value: "ok" },
      { label: "Agente de Risco nunca ignorado", ok: true, value: "ok" },
    ];
    const canAdvance = checks.every((c) => c.ok);
    return { canAdvance, checks, totals: { runs: (runs ?? []).length, positiveRuns: positiveRuns.length, totalTrades } };
  });

export const getAgentPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertOwner(supabase, userId);
    const { data } = await supabase
      .from("agent_performance_history")
      .select("*")
      .order("score", { ascending: false })
      .limit(500);
    // aggregate
    const agg: Record<string, { name: string; runs: number; hit_rate: number; good: number; bad: number; score: number }> = {};
    for (const r of data ?? []) {
      const a = (agg[r.agent_name] ??= { name: r.agent_name, runs: 0, hit_rate: 0, good: 0, bad: 0, score: 0 });
      a.runs++;
      a.good += r.good_votes;
      a.bad += r.bad_votes;
    }
    for (const k of Object.keys(agg)) {
      const a = agg[k];
      const tot = a.good + a.bad;
      a.hit_rate = tot ? (a.good / tot) * 100 : 0;
      a.score = a.hit_rate;
    }
    return Object.values(agg).sort((a, b) => b.score - a.score);
  });
