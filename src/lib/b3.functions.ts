// B3 Day Trade — server functions (Fase 2: comitê e votos)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";
import {
  B3_MT5_PRICE_DEVIATION_LIMIT,
  B3_MT5_SERVER,
  B3_MT5_SYMBOL,
  B3_MT5_TTL_SECONDS,
  B3QuoteProvider,
  assertFreshMt5Quote,
  getB3ExecutionAudit,
  type B3PriceSource,
} from "./b3-price-source.server";


interface Input {
  side: B3Side;
  qty: number;
  symbol?: string;
  contract_code?: string;
  base_price?: number;
}

export const runB3Committee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d || (d.side !== "buy" && d.side !== "sell")) throw new Error("side inválido");
    if (!Number.isFinite(d.qty) || d.qty <= 0) throw new Error("qty inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // settings
    const { data: settings } = await supabase
      .from("b3_trading_settings").select("*").eq("user_id", userId).maybeSingle();
    if (!settings) throw new Error("Configure o módulo B3 antes de rodar o comitê.");

    // resultado realizado hoje + contratos em aberto
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await supabase
      .from("b3_orders").select("status, net_result_brl, quantity")
      .eq("user_id", userId)
      .gte("created_at", `${today}T00:00:00Z`);
    const realized = (rows ?? []).filter((r: any) => r.status === "closed")
      .reduce((s: number, r: any) => s + Number(r.net_result_brl ?? 0), 0);
    const openContracts = (rows ?? []).filter((r: any) => r.status === "open")
      .reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0);

    // janela horária
    const now = new Date();
    const [sh, sm] = String(settings.start_time).split(":").map(Number);
    const [eh, em] = String(settings.end_time).split(":").map(Number);
    const [fh, fm] = String(settings.force_close_time).split(":").map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    const inside = cur >= sh * 60 + sm && cur <= eh * 60 + em;
    const forceClose = cur >= fh * 60 + fm;

    const risk: B3RiskState = {
      daily_loss_limit: Number(settings.daily_loss_limit),
      daily_gain_target: Number(settings.daily_gain_target),
      realized_today_brl: realized,
      open_contracts: openContracts,
      max_contracts: Number(settings.max_contracts),
      requested_qty: data.qty,
      inside_hours: inside,
      force_close_now: forceClose,
      strategy_mode: settings.strategy_mode as any,
    };

    const priceSrc = await B3QuoteProvider(supabase, userId, {
      symbol: data.symbol ?? "WIN",
      contract: data.contract_code ?? "WINFUT",
      base: data.base_price ?? 130000,
    });
    const ctx = priceSrc.ctx;
    if (priceSrc.source === "mt5_xp_demo") assertFreshMt5Quote(priceSrc, "runB3Committee");


    // settings de consenso por modo
    const mode = settings.strategy_mode as string;
    const committee: B3CommitteeSettings =
      mode === "conservador" ? { min_approve_votes: 6, min_confidence: 70, min_score: 75 } :
      mode === "agressivo"   ? { min_approve_votes: 4, min_confidence: 55, min_score: 55 } :
                               { min_approve_votes: 5, min_confidence: 62, min_score: 65 };

    const votes = runB3Agents(ctx, data.side, risk);
    const decision = buildB3Decision(votes, data.side, committee);

    // persiste votos (sem order_id — entrada simulada do comitê)
    const rowsToInsert = votes.map(v => ({
      user_id: userId,
      agent_name: v.agent_name,
      vote: v.vote,
      confidence: v.confidence,
      reason: v.reason,
      market_data_snapshot: {
        side: data.side, qty: data.qty, ctx_price: ctx.price, phase: ctx.session_phase,
        decision: decision.final, score: decision.score, data: v.data,
        has_veto: v.has_veto, veto_reason: v.veto_reason ?? null,
      } as any,
    }));
    const { error: insErr } = await (supabase as any).from("b3_agent_votes").insert(rowsToInsert);
    if (insErr) throw insErr;

    return {
      decision,
      votes: votes as any,
      context: {
        price: ctx.price, vwap: ctx.vwap, ema9: ctx.ema9, ema21: ctx.ema21,
        rsi: ctx.rsi, macd: ctx.macd, macd_signal: ctx.macd_signal,
        volume_ratio: ctx.volume_ratio, volatility_pct: ctx.volatility_pct,
        momentum: ctx.momentum, session_phase: ctx.session_phase,
      },
      risk,
      committee,
    } as any;
  });

export const listB3AgentVotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("b3_agent_votes").select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(80);
    if (error) throw error;
    return data ?? [];
  });

// Painel principal alimentado pela Simulação 3 Modos (run ativa do usuário)
export const getB3PanelOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: runs } = await (supabase as any).from("b3_simulation_runs")
      .select("*").eq("user_id", userId)
      .in("status", ["running", "paused"])
      .order("started_at", { ascending: false }).limit(1);
    const run = runs?.[0] ?? null;
    if (!run) return { run: null };

    const [{ data: modes }, { data: settings }, { data: openOrders }, { data: closedToday }] = await Promise.all([
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", run.id).eq("user_id", userId),
      (supabase as any).from("b3_simulation_mode_settings").select("*").eq("simulation_run_id", run.id).eq("user_id", userId),
      (supabase as any).from("b3_simulation_orders").select("id,mode,side,entry_price,quantity").eq("simulation_run_id", run.id).eq("user_id", userId).eq("status", "open"),
      (supabase as any).from("b3_simulation_orders").select("id,mode,net_result_brl,gross_result_brl,fees,gross_result_points,quantity,close_reason,exit_time")
        .eq("simulation_run_id", run.id).eq("user_id", userId).eq("status", "closed")
        .gte("exit_time", new Date(new Date().setHours(0,0,0,0)).toISOString()),
    ]);

    const enabledModes = (settings ?? []).filter((s: any) => s.enabled !== false).map((s: any) => s.mode);
    const useModes = (modes ?? []).filter((m: any) => enabledModes.length === 0 || enabledModes.includes(m.mode));

    const initial = useModes.reduce((s: number, m: any) => s + Number(m.initial_balance), 0);
    const balance = useModes.reduce((s: number, m: any) => s + Number(m.current_balance), 0);
    const realized = useModes.reduce((s: number, m: any) => s + Number(m.realized_pnl), 0);
    const fees = useModes.reduce((s: number, m: any) => s + Number(m.total_fees), 0);
    const points = useModes.reduce((s: number, m: any) => s + Number(m.points_result), 0);
    const contracts = useModes.reduce((s: number, m: any) => s + Number(m.contracts_traded), 0);
    const trades = useModes.reduce((s: number, m: any) => s + Number(m.total_trades), 0);
    const wins = useModes.reduce((s: number, m: any) => s + Number(m.winning_trades), 0);
    const losses = useModes.reduce((s: number, m: any) => s + Number(m.losing_trades), 0);
    const blocks = useModes.reduce((s: number, m: any) => s + Number(m.risk_blocks), 0);
    const grossToday = (closedToday ?? []).reduce((s: number, o: any) => s + Number(o.gross_result_brl ?? 0), 0);

    // janela efetiva (entre modos habilitados)
    const enabledSettings = (settings ?? []).filter((s: any) => s.enabled !== false);
    const minStart = enabledSettings.map((s: any) => s.trading_start_time).sort()[0] ?? "09:15";
    const maxClose = enabledSettings.map((s: any) => s.force_close_time).sort().slice(-1)[0] ?? "16:55";
    const dailyLossLimit = enabledSettings.reduce((s: number, x: any) => s + Number(x.daily_loss_limit_brl), 0);
    const dailyGainTarget = enabledSettings.reduce((s: number, x: any) => s + Number(x.daily_gain_target_brl), 0);

    const ranked = useModes.slice().sort((a: any, b: any) => Number(b.realized_pnl) - Number(a.realized_pnl));
    const leader = ranked[0] ?? null;

    return {
      run,
      enabled_modes: enabledModes,
      totals: {
        initial_balance: initial, current_balance: balance,
        realized_pnl: realized, gross_today: grossToday,
        fees, points, contracts, trades, wins, losses, blocks,
        open_orders: (openOrders ?? []).length,
        closed_today: (closedToday ?? []).length,
      },
      window: { start: minStart, force_close: maxClose, daily_loss_limit: dailyLossLimit, daily_gain_target: dailyGainTarget },
      leader: leader ? { mode: leader.mode, realized_pnl: Number(leader.realized_pnl) } : null,
      modes: useModes, settings: settings ?? [],
    };
  });

// Fonte de cotação (CSV vs MT5 XP DEMO) — leitura e escrita.
export const getB3PriceSourceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const info = await B3QuoteProvider(supabase, userId);
    const [{ data: lastEntry }, { data: lastExit }, { data: lastSnapshot }, { data: lastBlock }] = await Promise.all([
      (supabase as any).from("b3_simulation_orders")
        .select("entry_price, execution_price, execution_price_origin, quote_source, provider_name, legacy_price_detected, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("b3_simulation_orders")
        .select("exit_price, execution_price, execution_price_origin, quote_source, provider_name, legacy_price_detected, exit_time")
        .eq("user_id", userId).eq("status", "closed").order("exit_time", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("b3_simulation_market_snapshots")
        .select("market_time, provider_name, quote_source, quote_bid, quote_ask, quote_last, quote_symbol, quote_server, extra")
        .eq("user_id", userId).order("market_time", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("b3_simulation_block_events")
        .select("occurred_at, trigger, message, provider_name, price_source, rejected_price, mt5_last, diagnostic_payload")
        .eq("user_id", userId).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const legacyCalls = Number((lastSnapshot?.extra as any)?.legacy_provider_calls ?? info.legacy_provider_calls ?? 0);
    const mt5Calls = Number((lastSnapshot?.extra as any)?.mt5_provider_calls ?? info.mt5_provider_calls ?? 0);
    const lastEntryTime = lastEntry?.created_at ? new Date(lastEntry.created_at).getTime() : 0;
    const lastExitTime = lastExit?.exit_time ? new Date(lastExit.exit_time).getTime() : 0;
    const lastPriceFunction = lastExitTime > lastEntryTime
      ? lastExit?.execution_price_origin
      : lastEntry?.execution_price_origin;
    return {
      source: info.source,
      live: info.live,
      quote_age_s: info.quote_age_s,
      server: info.server,
      quote_symbol: info.quote_symbol,
      bid: info.raw?.bid ?? null,
      ask: info.raw?.ask ?? null,
      last: info.raw?.last ?? null,
      spread: info.raw?.spread ?? null,
      ctx_price: info.ctx.price,
      provider_name: info.provider_name,
      quote_source: info.quote_source,
      quote_tick_ts: info.raw?.tick_ts ?? null,
      fallback_to_csv: info.fallback_to_csv,
      mt5_provider_calls: mt5Calls,
      legacy_provider_calls: legacyCalls,
      last_entry_price: lastEntry?.entry_price ?? lastEntry?.execution_price ?? null,
      last_exit_price: lastExit?.exit_price ?? lastExit?.execution_price ?? null,
      last_price_function: lastPriceFunction ?? null,
      last_entry_source: lastEntry?.quote_source ?? null,
      last_exit_source: lastExit?.quote_source ?? null,
      last_block: lastBlock ?? null,
      guard: {
        required_symbol: B3_MT5_SYMBOL,
        required_server: B3_MT5_SERVER,
        ttl_seconds: B3_MT5_TTL_SECONDS,
        max_deviation_points: B3_MT5_PRICE_DEVIATION_LIMIT,
      },
    };
  });

export const setB3PriceSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { source: B3PriceSource }) => {
    if (!d || (d.source !== "csv" && d.source !== "mt5_xp_demo")) throw new Error("source inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: currentSettings } = await supabase.from("b3_trading_settings")
      .select("price_source").eq("user_id", userId).maybeSingle();
    const previousSource = (currentSettings?.price_source as B3PriceSource | undefined) ?? "csv";
    // upsert seguro caso o usuário ainda não tenha b3_trading_settings.
    const { data: existing } = await supabase.from("b3_trading_settings")
      .select("id").eq("user_id", userId).maybeSingle();
    if (existing) {
      const { error } = await supabase.from("b3_trading_settings")
        .update({ price_source: data.source }).eq("user_id", userId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("b3_trading_settings")
        .insert({ user_id: userId, price_source: data.source });
      if (error) throw error;
    }
    let resetMessage: string | null = null;
    if (previousSource !== "mt5_xp_demo" && data.source === "mt5_xp_demo") {
      const now = new Date().toISOString();
      await Promise.all([
        (supabase as any).from("b3_simulation_orders")
          .update({ status: "cancelled", close_reason: "Fonte alterada para MT5 XP DEMO — estado operacional legado reiniciado" })
          .eq("user_id", userId).eq("status", "open"),
        (supabase as any).from("b3_orders")
          .update({ status: "cancelled", close_reason: "Fonte alterada para MT5 XP DEMO — estado operacional legado reiniciado", exit_time: now })
          .eq("user_id", userId).eq("status", "open"),
        (supabase as any).from("b3_simulation_modes")
          .update({ current_status: "operando", status_reason: "Fonte alterada para MT5 XP DEMO — estado operacional legado reiniciado", status_changed_at: now, last_trigger: "price_source_reset" })
          .eq("user_id", userId),
      ]);
      resetMessage = "Fonte alterada para MT5 XP DEMO — estado operacional legado reiniciado";
    }
    return { ok: true, source: data.source, message: resetMessage };
  });

export const openB3ManualOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { side: B3Side; qty: number; contract_code?: string; environment?: "simulation" | "real" }) => {
    if (!d || (d.side !== "buy" && d.side !== "sell")) throw new Error("side inválido");
    if (!Number.isFinite(d.qty) || d.qty <= 0) throw new Error("qty inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: settings } = await supabase.from("b3_trading_settings").select("max_contracts, environment").eq("user_id", userId).maybeSingle();
    if (Number(data.qty) > Number(settings?.max_contracts ?? 1)) throw new Error(`Quantidade ${data.qty} excede limite (${settings?.max_contracts ?? 1}).`);
    const info = await B3QuoteProvider(supabase, userId, { symbol: "WIN", contract: data.contract_code ?? "WINFUT", base: 130000 });
    const audit = getB3ExecutionAudit(info, data.side, "entry", "openB3ManualOrder");
    if (info.source === "mt5_xp_demo" && audit.quote_source !== "MT5 XP DEMO") throw new Error("Preço de execução incompatível com a cotação MT5 — operação bloqueada");
    const { error } = await (supabase as any).from("b3_orders").insert({
      user_id: userId,
      symbol: "WIN",
      contract_code: data.contract_code ?? "WINFUT",
      side: data.side,
      entry_price: audit.execution_price,
      quantity: data.qty,
      entry_time: new Date().toISOString(),
      fees: 0.5 * data.qty,
      status: "open",
      environment: "simulation",
      quote_source: audit.quote_source,
      quote_server: audit.quote_server,
      quote_symbol: audit.quote_symbol,
      quote_tick_ts: audit.quote_tick_ts,
      quote_bid: audit.quote_bid,
      quote_ask: audit.quote_ask,
      quote_last: audit.quote_last,
      execution_price: audit.execution_price,
      execution_price_origin: audit.execution_price_origin,
      legacy_price_detected: audit.legacy_price_detected,
      provider_name: audit.provider_name,
    });
    if (error) throw error;
    return { ok: true, price: audit.execution_price, source: audit.quote_source };
  });

export const closeB3ManualOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: order } = await (supabase as any).from("b3_orders").select("*").eq("id", data.order_id).eq("user_id", userId).maybeSingle();
    if (!order || order.status !== "open") throw new Error("Ordem aberta não encontrada.");
    const info = await B3QuoteProvider(supabase, userId, { symbol: "WIN", contract: order.contract_code ?? "WINFUT", base: 130000 });
    if (info.source === "mt5_xp_demo" && order.quote_source !== "MT5 XP DEMO") {
      await (supabase as any).from("b3_orders").update({
        status: "cancelled",
        close_reason: "Fonte alterada para MT5 XP DEMO — operação legada invalidada",
        exit_time: new Date().toISOString(),
      }).eq("id", order.id).eq("user_id", userId);
      throw new Error("Operação aberta com preço legado invalidada — não será misturada com MT5 XP DEMO.");
    }
    const audit = getB3ExecutionAudit(info, order.side, "exit", "closeB3ManualOrder");
    if (info.source === "mt5_xp_demo" && audit.quote_source !== "MT5 XP DEMO") throw new Error("Preço de execução incompatível com a cotação MT5 — operação bloqueada");
    const points = order.side === "buy" ? audit.execution_price - Number(order.entry_price) : Number(order.entry_price) - audit.execution_price;
    const grossBRL = points * 0.2 * Number(order.quantity ?? 1);
    const totalFees = Number(order.fees ?? 0) + 0.5 * Number(order.quantity ?? 1);
    const net = grossBRL - totalFees;
    const { error } = await (supabase as any).from("b3_orders").update({
      exit_price: audit.execution_price,
      exit_time: new Date().toISOString(),
      gross_result_points: points,
      gross_result_brl: grossBRL,
      fees: totalFees,
      net_result_brl: net,
      status: "closed",
      close_reason: "manual",
      quote_source: audit.quote_source,
      quote_server: audit.quote_server,
      quote_symbol: audit.quote_symbol,
      quote_tick_ts: audit.quote_tick_ts,
      quote_bid: audit.quote_bid,
      quote_ask: audit.quote_ask,
      quote_last: audit.quote_last,
      execution_price: audit.execution_price,
      execution_price_origin: audit.execution_price_origin,
      legacy_price_detected: audit.legacy_price_detected,
      provider_name: audit.provider_name,
    }).eq("id", order.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true, price: audit.execution_price, source: audit.quote_source };
  });

