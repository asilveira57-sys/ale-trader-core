// B3 Day Trade — Fase 2.5: simulação comparativa dos 3 modos
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";
import {
  evaluateB3Protection, resetB3ProtectionForNewDay, b3DayKeyBRT,
  type B3ProtectionRuntime, type B3ProtectionSettings,
} from "./b3-protection.server";
import {
  B3_MT5_SERVER,
  B3_MT5_SYMBOL,
  B3_MT5_TTL_SECONDS,
  B3QuoteProvider,
  assertB3StrictMt5ExecutionAudit,
  getB3ExecutionAudit,
  quoteAuditBase,
  type B3PriceContextResult,
  type B3QuoteExecutionAudit,
} from "./b3-price-source.server";


const POINT_VALUE_BRL = 0.2;
const TICK = 5;

type Mode = "conservador" | "moderado" | "equilibrado" | "semi_agressivo" | "agressivo";
const MODES: Mode[] = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"];

interface ModeDefaults {
  min_approve_votes: number; min_confidence: number; min_score: number;
  max_contracts: number; stop_pts: number; gain_pts: number; max_volatility_pct: number;
  daily_loss_limit_brl: number; daily_gain_target_brl: number;
}
const MODE_DEFAULTS: Record<Mode, ModeDefaults> = {
  conservador:    { min_approve_votes: 6, min_confidence: 70, min_score: 75, max_contracts: 1, stop_pts: 100, gain_pts: 200, max_volatility_pct: 2.5, daily_loss_limit_brl: 100, daily_gain_target_brl: 200 },
  moderado:       { min_approve_votes: 5, min_confidence: 62, min_score: 65, max_contracts: 2, stop_pts: 150, gain_pts: 300, max_volatility_pct: 3.5, daily_loss_limit_brl: 300, daily_gain_target_brl: 500 },
  equilibrado:    { min_approve_votes: 5, min_confidence: 70, min_score: 62, max_contracts: 3, stop_pts: 220, gain_pts: 440, max_volatility_pct: 3.8, daily_loss_limit_brl: 500, daily_gain_target_brl: 700 },
  semi_agressivo: { min_approve_votes: 5, min_confidence: 60, min_score: 60, max_contracts: 4, stop_pts: 300, gain_pts: 600, max_volatility_pct: 4.0, daily_loss_limit_brl: 800, daily_gain_target_brl: 1000 },
  agressivo:      { min_approve_votes: 4, min_confidence: 55, min_score: 55, max_contracts: 3, stop_pts: 200, gain_pts: 400, max_volatility_pct: 4.5, daily_loss_limit_brl: 600, daily_gain_target_brl: 1200 },
};

function hhmmToMin(s: string) { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; }

function saoPauloMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

// ───────────────────── start ─────────────────────
interface StartInput {
  initial_balance?: number;
  max_contracts?: number;
  fee_brl?: number;
  slippage_pts?: number;
  trading_start_time?: string;
  entry_cutoff_time?: string;
  force_close_time?: string;
  notes?: string;
}
export const startB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: StartInput) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const initial = Number(data.initial_balance ?? 10000);
    const { data: run, error } = await (supabase as any)
      .from("b3_simulation_runs")
      .insert({
        user_id: userId,
        initial_balance: initial,
        max_contracts: Number(data.max_contracts ?? 1),
        simulated_fee_brl: Number(data.fee_brl ?? 1.5),
        simulated_slippage_pts: Number(data.slippage_pts ?? 0),
        trading_start_time: data.trading_start_time ?? "09:15",
        entry_cutoff_time: data.entry_cutoff_time ?? "16:30",
        force_close_time: data.force_close_time ?? "16:55",
        notes: data.notes ?? null,
        status: "running",
      })
      .select("*").single();
    if (error) throw error;

    const modeRows = MODES.map(m => ({
      simulation_run_id: run.id, user_id: userId, mode: m,
      initial_balance: initial, current_balance: initial,
    }));
    const { error: mErr } = await (supabase as any).from("b3_simulation_modes").insert(modeRows);
    if (mErr) throw mErr;

    const settingRows = MODES.map(m => ({
      simulation_run_id: run.id, user_id: userId, mode: m, ...MODE_DEFAULTS[m],
      trading_start_time: run.trading_start_time,
      entry_cutoff_time: run.entry_cutoff_time,
      force_close_time: run.force_close_time,
    }));
    await (supabase as any).from("b3_simulation_mode_settings").insert(settingRows);
    return run;
  });

// ───────────────────── controls ─────────────────────
export const setB3SimulationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; status: "running" | "paused" | "finished" | "cancelled" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: any = { status: data.status };
    if (data.status === "finished" || data.status === "cancelled") patch.ended_at = new Date().toISOString();
    const { error } = await (supabase as any).from("b3_simulation_runs")
      .update(patch).eq("id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const setB3SimulationWinner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_simulation_runs")
      .update({ winner_mode: data.mode }).eq("id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// ───────────────────── list / detail ─────────────────────
export const listB3Simulations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("b3_simulation_runs")
      .select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(30);
    if (error) throw error;
    return data ?? [];
  });

export const getB3SimulationDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [runR, modesR, settingsR, ordersR, legacyOrdersR, snapsR] = await Promise.all([
      (supabase as any).from("b3_simulation_runs").select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId),
      (supabase as any).from("b3_trading_settings").select("price_source").eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_orders").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: false }).limit(500),
      (supabase as any).from("b3_simulation_orders").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).limit(5000),
      (supabase as any).from("b3_simulation_market_snapshots").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("market_time", { ascending: false }).limit(120),
    ]);
    if (runR.error) throw runR.error;
    if (!runR.data) throw new Error("Run não encontrada");
    const isMt5Source = settingsR.data?.price_source === "mt5_xp_demo";
    const allOrders = (ordersR.data ?? []) as any[];
    const allCountOrders = (legacyOrdersR.data ?? []) as any[];
    const visibleOrders = isMt5Source
      ? allCountOrders.filter((o) => o.quote_source === "MT5 XP DEMO" && o.provider_name === "B3QuoteProvider")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 500)
      : allOrders;
    const hiddenLegacyCount = isMt5Source
      ? allCountOrders.filter((o) => o.quote_source !== "MT5 XP DEMO" || o.provider_name !== "B3QuoteProvider").length
      : 0;
    const visibleModes = isMt5Source
      ? ((modesR.data ?? []) as any[]).map((m) => {
        const orders = visibleOrders.filter((o) => o.mode === m.mode);
        const closed = orders.filter((o) => o.status === "closed");
        const realized = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
        const fees = orders.reduce((s, o) => s + Number(o.fees ?? 0), 0);
        const wins = closed.filter((o) => Number(o.net_result_brl ?? 0) > 0).length;
        const losses = closed.filter((o) => Number(o.net_result_brl ?? 0) < 0).length;
        const maxGain = closed.reduce((v, o) => Math.max(v, Number(o.net_result_brl ?? 0)), 0);
        const maxLoss = closed.reduce((v, o) => Math.min(v, Number(o.net_result_brl ?? 0)), 0);
        const points = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
        const contracts = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
        let acc = 0, peak = 0, dd = 0;
        for (const o of closed.slice().sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime())) {
          acc += Number(o.net_result_brl ?? 0);
          peak = Math.max(peak, acc);
          dd = Math.max(dd, peak - acc);
        }
        return {
          ...m,
          realized_pnl: realized,
          unrealized_pnl: 0,
          current_balance: Number(m.initial_balance ?? 0) + realized,
          total_fees: fees,
          total_trades: closed.length,
          winning_trades: wins,
          losing_trades: losses,
          max_gain: maxGain,
          max_loss: maxLoss,
          max_drawdown: dd,
          points_result: points,
          contracts_traded: contracts,
        };
      })
      : (modesR.data ?? []);
    return {
      run: runR.data,
      modes: visibleModes,
      price_source: settingsR.data?.price_source ?? "csv",
      orders: visibleOrders,
      legacy_orders_hidden: hiddenLegacyCount,
      snapshots: snapsR.data ?? [],
    };
  });

// ───────────────────── tick (core, reutilizado por hook público) ─────────────────────
export async function runB3SimulationTick(
  supabase: any,
  userId: string,
  runId: string,
  ticks = 1,
): Promise<{ ok?: boolean; skipped?: boolean; reason?: string; processed?: number; log: any[] }> {
  ticks = Math.min(Math.max(1, Number(ticks)), 60);

  const { data: run, error: runErr } = await supabase.from("b3_simulation_runs")
    .select("*").eq("id", runId).eq("user_id", userId).maybeSingle();
  if (runErr) throw runErr;
  if (!run) throw new Error("Run não encontrada");
  if (run.status !== "running") return { skipped: true, reason: `Status ${run.status}`, log: [] };

  const { data: modeRows, error: mErr } = await supabase.from("b3_simulation_modes")
    .select("*").eq("simulation_run_id", runId).eq("user_id", userId);
  if (mErr) throw mErr;
  const modeById: Record<string, any> = {};
  const modeByName: Record<string, any> = {};
  for (const m of modeRows ?? []) { modeById[m.id] = m; modeByName[m.mode] = m; }

  // settings por modo (criadas no start; backfill garante existência em runs antigas)
  const { data: settingsRows } = await supabase.from("b3_simulation_mode_settings")
    .select("*").eq("simulation_run_id", runId).eq("user_id", userId);
  const settingsByMode: Record<string, any> = {};
  for (const s of settingsRows ?? []) settingsByMode[s.mode] = s;
  // garante defaults se faltar
  for (const m of MODES) {
    if (!settingsByMode[m]) {
      settingsByMode[m] = {
        ...MODE_DEFAULTS[m], enabled: true,
        trading_start_time: run.trading_start_time,
        entry_cutoff_time: run.entry_cutoff_time,
        force_close_time: run.force_close_time,
      };
    }
  }

  const now0 = new Date();
  const { data: macros } = await supabase.from("b3_macro_events")
    .select("*").eq("user_id", userId).eq("active", true)
    .lte("block_start", new Date(now0.getTime() + 24 * 3600 * 1000).toISOString())
    .gte("block_end", new Date(now0.getTime() - 24 * 3600 * 1000).toISOString());

  const log: any[] = [];
  let openOrdersCache: any[] | null = null;
  async function getOpen() {
    if (openOrdersCache) return openOrdersCache;
    const { data: o } = await supabase.from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", runId).eq("user_id", userId).eq("status", "open");
    openOrdersCache = o ?? [];
    return openOrdersCache;
  }

  // PnL realizado SOMENTE no dia de hoje (BRT) — usado para gate de
  // daily_loss_limit / daily_gain_target. Antes usávamos m.realized_pnl
  // (cumulativo), o que travava modos que já bateram a meta em dias anteriores.
  async function getRealizedTodayByMode(): Promise<Record<string, number>> {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    // 00:00 BRT (UTC-3) = 03:00 UTC do mesmo dia
    const startUtcIso = `${parts}T03:00:00.000Z`;
    const { data: closedToday } = await supabase.from("b3_simulation_orders")
      .select("mode, net_result_brl, exit_time")
      .eq("simulation_run_id", runId).eq("user_id", userId).eq("status", "closed")
      .gte("exit_time", startUtcIso);
    const map: Record<string, number> = { conservador: 0, moderado: 0, equilibrado: 0, semi_agressivo: 0, agressivo: 0 };
    for (const r of closedToday ?? []) {
      map[r.mode as string] = (map[r.mode as string] || 0) + Number(r.net_result_brl ?? 0);
    }
    return map;
  }
  let realizedTodayByMode = await getRealizedTodayByMode();

  const providerStats = {
    selected_source: "desconhecida" as string,
    provider_used: "B3QuoteProvider",
    mt5_provider_calls: 0,
    legacy_provider_calls: 0,
    fallback_to_csv: false,
    last_entry_price: null as number | null,
    last_exit_price: null as number | null,
    last_price_function: null as string | null,
    valid_mt5_orders: 0,
    legacy_orders_invalidated: 0,
  };

  function rememberProvider(info: B3PriceContextResult) {
    providerStats.selected_source = info.quote_source;
    providerStats.mt5_provider_calls += info.mt5_provider_calls;
    providerStats.legacy_provider_calls += info.legacy_provider_calls;
    providerStats.fallback_to_csv = providerStats.fallback_to_csv || info.fallback_to_csv;
  }

  function mt5InvalidReason(info: B3PriceContextResult): string | null {
    if (info.source !== "mt5_xp_demo") return null;
    const guardEval = info.guard_evaluation;
    if (!guardEval) return "Guard MT5 sem avaliação.";
    return guardEval.ok ? null : (guardEval.first_block_reason ?? "Guard MT5 rejeitou o tick.");
  }

  async function recomputeModeTotalsFromValidMt5Orders() {
    const { data: validOrders } = await supabase.from("b3_simulation_orders")
      .select("*").eq("simulation_run_id", runId).eq("user_id", userId)
      .eq("quote_source", "MT5 XP DEMO").eq("provider_name", "B3QuoteProvider");
    const byMode: Record<string, any[]> = {};
    for (const mode of MODES) byMode[mode] = [];
    for (const o of (validOrders ?? [])) if (byMode[o.mode]) byMode[o.mode].push(o);
    providerStats.valid_mt5_orders = (validOrders ?? []).length;

    for (const mode of MODES) {
      const m = modeByName[mode];
      if (!m) continue;
      const orders = byMode[mode] ?? [];
      const closed = orders.filter((o) => o.status === "closed");
      const open = orders.filter((o) => o.status === "open");
      const realized = closed.reduce((s, o) => s + Number(o.net_result_brl ?? 0), 0);
      const fees = orders.reduce((s, o) => s + Number(o.fees ?? 0), 0);
      const wins = closed.filter((o) => Number(o.net_result_brl ?? 0) > 0).length;
      const losses = closed.filter((o) => Number(o.net_result_brl ?? 0) < 0).length;
      const maxGain = closed.reduce((v, o) => Math.max(v, Number(o.net_result_brl ?? 0)), 0);
      const maxLoss = closed.reduce((v, o) => Math.min(v, Number(o.net_result_brl ?? 0)), 0);
      const points = closed.reduce((s, o) => s + Number(o.gross_result_points ?? 0), 0);
      const contracts = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
      let acc = 0, peak = 0, dd = 0;
      for (const o of closed.slice().sort((a, b) => new Date(a.exit_time ?? a.created_at).getTime() - new Date(b.exit_time ?? b.created_at).getTime())) {
        acc += Number(o.net_result_brl ?? 0);
        peak = Math.max(peak, acc);
        dd = Math.max(dd, peak - acc);
      }
      const patch = {
        realized_pnl: realized,
        unrealized_pnl: 0,
        current_balance: Number(m.initial_balance) + realized,
        total_fees: fees,
        total_trades: closed.length,
        winning_trades: wins,
        losing_trades: losses,
        max_gain: maxGain,
        max_loss: maxLoss,
        max_drawdown: dd,
        points_result: points,
        contracts_traded: contracts,
      };
      await supabase.from("b3_simulation_modes").update(patch).eq("id", m.id).eq("user_id", userId);
      Object.assign(m, patch);
      if (open.length === 0) continue;
    }
  }

  async function invalidateLegacyOrdersForMt5(info: B3PriceContextResult) {
    if (info.source !== "mt5_xp_demo") return;
    const { data: legacyOrders } = await supabase.from("b3_simulation_orders")
      .select("id, mode, status, entry_price, exit_price, quote_source, provider_name")
      .eq("simulation_run_id", runId).eq("user_id", userId);
    const rows = (legacyOrders ?? []).filter((o: any) => o.quote_source !== "MT5 XP DEMO" || o.provider_name !== "B3QuoteProvider");
    if (!rows.length) {
      await recomputeModeTotalsFromValidMt5Orders();
      return;
    }
    const nowIso = new Date().toISOString();
    const ids = rows.map((o: any) => o.id);
    await supabase.from("b3_simulation_orders").update({
      status: "cancelled",
      close_reason: "Operação legada invalidada — modo MT5 XP DEMO exige preço B3QuoteProvider",
      exit_time: nowIso,
    }).in("id", ids).eq("user_id", userId);
    providerStats.legacy_orders_invalidated += rows.length;
    openOrdersCache = null;
    for (const o of rows.slice(0, 20)) {
      const m = modeByName[o.mode];
      if (!m) continue;
      await recordStatusIfChanged(o.mode, m, m.current_status ?? "operando", "legacy_price_invalidated", {
        related_order_id: o.id,
        message: "Operação legada ocultada/invalida — modo MT5 XP DEMO exige preço B3QuoteProvider",
        provider_name: info.provider_name,
        price_source: info.quote_source,
        rejected_price: Number(o.exit_price ?? o.entry_price ?? 0),
        mt5_last: info.raw?.last ?? null,
        forceLog: true,
        diagnostic_payload: { function: "invalidateLegacyOrdersForMt5", order_quote_source: o.quote_source, order_provider_name: o.provider_name, ...quoteAuditBase(info) },
      });
    }
    await recomputeModeTotalsFromValidMt5Orders();
  }

  function orderAuditPatch(audit: B3QuoteExecutionAudit) {
    return {
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
    };
  }

  // Helper: registra mudança de status operacional (parou de operar / voltou)
  async function recordStatusIfChanged(
    mode: string, m: any, newStatus: string, trigger: string,
    opts: {
      observed?: number; limit?: number; pnl?: number; related_order_id?: string; message?: string;
      provider_name?: string; price_source?: string; rejected_price?: number | null; mt5_last?: number | null; diagnostic_payload?: any;
      forceLog?: boolean;
    } = {},
  ) {
    const prev = m.current_status ?? "operando";
    if (prev === newStatus && !opts.forceLog) return;
    await supabase.from("b3_simulation_block_events").insert({
      simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
      mode, prev_status: prev, new_status: newStatus, trigger,
      observed_value: opts.observed ?? null,
      limit_value: opts.limit ?? null,
      pnl_at_moment: opts.pnl ?? null,
      related_order_id: opts.related_order_id ?? null,
      message: opts.message ?? null,
      provider_name: opts.provider_name ?? null,
      price_source: opts.price_source ?? null,
      rejected_price: opts.rejected_price ?? null,
      mt5_last: opts.mt5_last ?? null,
      diagnostic_payload: opts.diagnostic_payload ?? {},
    });
    if (prev !== newStatus) {
      await supabase.from("b3_simulation_modes").update({
        current_status: newStatus, status_reason: opts.message ?? null,
        status_changed_at: new Date().toISOString(), last_trigger: trigger,
      }).eq("id", m.id);
      m.current_status = newStatus;
      m.status_reason = opts.message ?? null;
      m.status_changed_at = new Date().toISOString();
      m.last_trigger = trigger;
    }
  }

  function auditCheck(key: string, label: string, ok: boolean, detail?: string, blocking = true) {
    return { key, label, status: ok ? "OK" : "NÃO", ok, detail: detail ?? null, blocking };
  }

  function normalizeModeConfig(cfgRow: any) {
    return {
      enabled: cfgRow.enabled !== false,
      volatility: Number(cfgRow.max_volatility_pct),
      score: Number(cfgRow.min_score),
      confidence: Number(cfgRow.min_confidence),
      min_approve_votes: Number(cfgRow.min_approve_votes),
      gain: Number(cfgRow.gain_pts),
      stop: Number(cfgRow.stop_pts),
      contracts: Number(cfgRow.max_contracts),
      daily_loss: Number(cfgRow.daily_loss_limit_brl),
      daily_target: Number(cfgRow.daily_gain_target_brl),
      trading_start_time: String(cfgRow.trading_start_time),
      entry_cutoff_time: String(cfgRow.entry_cutoff_time),
      force_close_time: String(cfgRow.force_close_time),
    };
  }

  function configComparison(cfgRow: any, loaded: any) {
    const saved = normalizeModeConfig(cfgRow);
    const keys = ["volatility", "score", "confidence", "gain", "stop", "contracts", "daily_loss", "daily_target", "trading_start_time", "entry_cutoff_time", "force_close_time"];
    const fields: Record<string, any> = {};
    for (const key of keys) {
      const screen = (saved as any)[key];
      const motor = (loaded as any)[key];
      fields[key] = { screen, motor, matches: String(screen) === String(motor) };
    }
    return { screen: saved, motor: loaded, fields, mismatch_count: Object.values(fields).filter((v: any) => !v.matches).length };
  }

  function finalReasonFromDecision(decision: any, committee: B3CommitteeSettings) {
    if (decision.final === "approved") return `Setup ${decision.side === "buy" ? "BUY" : "SELL"} aprovado.`;
    if (decision.final === "blocked") return decision.vetoes?.length ? `Bloqueado pelo comitê: ${decision.vetoes.join(" | ")}` : "Proteção global ou veto do comitê.";
    if (Number(decision.score) < Number(committee.min_score)) return "Score insuficiente.";
    if (Number(decision.avg_confidence) < Number(committee.min_confidence)) return "Confiança insuficiente.";
    if (Number(decision.approve_votes) < Number(committee.min_approve_votes)) return "Votos insuficientes no comitê.";
    if (decision.final === "rejected") return "Nenhum setup encontrado — agentes rejeitaram o sinal.";
    return "Nenhum setup encontrado.";
  }


  for (let i = 0; i < ticks; i++) {
    const now = new Date();
    const cur = saoPauloMinutes(now);

    const priceSrc = await B3QuoteProvider(supabase, userId, { symbol: "WIN", contract: "WINFUT", base: 130000 });
    rememberProvider(priceSrc);
    const ctx = priceSrc.ctx;
    const invalidMt5 = mt5InvalidReason(priceSrc);
    await invalidateLegacyOrdersForMt5(priceSrc);
    const macroBlock = (macros ?? []).find((m: any) => {
      const a = new Date(m.block_start).getTime();
      const b = new Date(m.block_end).getTime();
      return now.getTime() >= a && now.getTime() <= b;
    });
    const globalProtectionActive = Boolean(invalidMt5 || macroBlock);
    const globalProtectionReason = invalidMt5
      ? invalidMt5
      : macroBlock
      ? `Evento macro ativo: ${macroBlock.name}`
      : "Inativa";
    const snapshotExtra: any = { ema9: ctx.ema9, ema21: ctx.ema21, rsi: ctx.rsi, macd: ctx.macd, macd_signal: ctx.macd_signal,
      momentum: ctx.momentum, volatility_pct: ctx.volatility_pct, session_phase: ctx.session_phase,
      price_source: priceSrc.source, quote_age_s: priceSrc.quote_age_s, quote_symbol: priceSrc.quote_symbol,
      bid: priceSrc.raw?.bid, ask: priceSrc.raw?.ask, last: priceSrc.raw?.last,
      provider_name: priceSrc.provider_name, fallback_to_csv: priceSrc.fallback_to_csv,
      mt5_provider_calls: providerStats.mt5_provider_calls, legacy_provider_calls: providerStats.legacy_provider_calls,
      global_protection: { active: globalProtectionActive, reason: globalProtectionReason },
      tick_guard: priceSrc.guard_evaluation ? {
        mode: priceSrc.guard.mode,
        ok: priceSrc.guard_evaluation.ok,
        first_block_reason: priceSrc.guard_evaluation.first_block_reason,
        settings: priceSrc.guard_evaluation.settings,
        spread_pts: priceSrc.guard_evaluation.spread_pts,
        spread_ticks: priceSrc.guard_evaluation.spread_ticks,
        tick_age_s: priceSrc.guard_evaluation.tick_age_s,
        checks: priceSrc.guard_evaluation.checks,
      } : null,
    };
    const { data: snapIns, error: sErr } = await supabase.from("b3_simulation_market_snapshots")
      .insert({
        simulation_run_id: runId, user_id: userId, symbol: "WIN",
        price: ctx.price, candle_open: ctx.open, candle_high: ctx.high, candle_low: ctx.low,
        candle_close: ctx.price, volume: ctx.volume_ratio, vwap: ctx.vwap,
        market_time: now.toISOString(),
        source: priceSrc.live ? `mt5:${priceSrc.server ?? "xp"}` : (priceSrc.source === "mt5_xp_demo" ? "mt5:sem_tick" : "mock"),
        quote_source: priceSrc.quote_source,
        quote_server: priceSrc.server,
        quote_symbol: priceSrc.quote_symbol,
        quote_tick_ts: priceSrc.raw?.tick_ts ?? null,
        quote_bid: priceSrc.raw?.bid ?? null,
        quote_ask: priceSrc.raw?.ask ?? null,
        quote_last: priceSrc.raw?.last ?? null,
        provider_name: priceSrc.provider_name,
        extra: snapshotExtra,
      }).select("id").single();
    if (sErr) throw sErr;


    const intendedSide: B3Side = ctx.ema9 >= ctx.ema21 ? "buy" : "sell";
    const tickAudit: any = {
      snapshot_id: snapIns.id,
      tick_index: i + 1,
      timestamp: now.toISOString(),
      source: priceSrc.source,
      provider_name: priceSrc.provider_name,
      last_tick: {
        bid: priceSrc.raw?.bid ?? null,
        ask: priceSrc.raw?.ask ?? null,
        last: priceSrc.raw?.last ?? null,
        spread: priceSrc.raw?.spread ?? ctx.spread_pts ?? null,
        tick_ts: priceSrc.raw?.tick_ts ?? null,
        age_s: priceSrc.quote_age_s,
        server: priceSrc.server,
        symbol: priceSrc.quote_symbol,
      },
      global_protection: {
        status: globalProtectionActive ? "Ativa" : "Inativa",
        active: globalProtectionActive,
        reason: globalProtectionReason,
      },
      tick_guard: snapshotExtra.tick_guard,
      modes: [] as any[],
    };

    for (const mode of MODES) {
      const m = modeByName[mode];
      if (!m) continue;
      const cfg = settingsByMode[mode];
      const realizedToday = Number(realizedTodayByMode[mode] ?? 0);
      const startMin = hhmmToMin(cfg.trading_start_time);
      const cutoffMin = hhmmToMin(cfg.entry_cutoff_time);
      const forceMin = hhmmToMin(cfg.force_close_time);
      const insideHours = cur >= startMin && cur <= cutoffMin;
      const forceClose = cur >= forceMin || cur < startMin;
      const openList = await getOpen();
      const open = (openList ?? []).find((o: any) => o.simulation_mode_id === m.id);
      const loadedConfig = normalizeModeConfig(cfg);
      const cfgCompare = configComparison(cfg, loadedConfig);
      const checks: any[] = [];
      const addCheck = (key: string, label: string, ok: boolean, detail?: string, blocking = true) => checks.push(auditCheck(key, label, ok, detail, blocking));
      const finalizeAudit = (finalReason: string, extra: Record<string, any> = {}) => {
        const firstStop = checks.find((c) => c.blocking && !c.ok);
        tickAudit.modes.push({
          mode,
          timestamp: now.toISOString(),
          last_tick: tickAudit.last_tick,
          last_analysis: extra.last_analysis ?? null,
          last_score: extra.last_score ?? null,
          last_confidence: extra.last_confidence ?? null,
          last_setup: extra.last_setup ?? "Nenhum setup aprovado",
          last_refusal_reason: finalReason,
          first_stop: firstStop ? { key: firstStop.key, label: firstStop.label, detail: firstStop.detail } : null,
          config_loaded: cfgCompare.motor,
          config_saved: cfgCompare.screen,
          config_comparison: cfgCompare.fields,
          config_mismatch_count: cfgCompare.mismatch_count,
          protection_global: tickAudit.global_protection,
          checks,
          signals: extra.signals ?? { evaluated_side: intendedSide, buy: false, sell: false },
          committee: extra.committee ?? null,
        });
      };

      addCheck("tick_received", "Tick recebido", priceSrc.source !== "mt5_xp_demo" || Boolean(priceSrc.raw), priceSrc.raw?.tick_ts ? `tick ${priceSrc.raw.tick_ts}` : "sem tick MT5");
      addCheck("mt5_server", "Servidor MT5", priceSrc.source !== "mt5_xp_demo" || priceSrc.server === "XPMT5-DEMO" || priceSrc.server === "XPMT5-PRD", priceSrc.server ? `recebido ${priceSrc.server}` : "sem servidor");
      addCheck("mt5_symbol", "Símbolo WINQ26", priceSrc.source !== "mt5_xp_demo" || priceSrc.quote_symbol === B3_MT5_SYMBOL, priceSrc.quote_symbol ? `recebido ${priceSrc.quote_symbol}` : "sem símbolo");
      addCheck("market_open", "Mercado aberto", ctx.session_phase !== "fora", `fase ${ctx.session_phase}`);
      addCheck("time_allowed", "Horário permitido", insideHours, `${cfg.trading_start_time}–${cfg.entry_cutoff_time}`);
      addCheck("operation_window", "Janela operacional", insideHours, `${cfg.trading_start_time}–${cfg.entry_cutoff_time}`);
      addCheck("force_close_window", "Janela zeragem", !forceClose, `zeragem ${cfg.force_close_time}`);
      addCheck("valid_quote", "Cotação válida", !invalidMt5, invalidMt5 ?? `bid ${priceSrc.raw?.bid ?? "—"} · ask ${priceSrc.raw?.ask ?? "—"}`);
      addCheck("spread", "Spread", Number(ctx.spread_pts ?? priceSrc.raw?.spread ?? 0) > 0, `${Number(ctx.spread_pts ?? priceSrc.raw?.spread ?? 0)} pts`, false);
      addCheck("global_protection", "Proteção Global", !globalProtectionActive, globalProtectionReason);

      if (invalidMt5) {
        await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
          pnl: realizedToday,
          message: invalidMt5,
          provider_name: priceSrc.provider_name,
          price_source: priceSrc.quote_source,
          rejected_price: ctx.price,
          mt5_last: priceSrc.raw?.last ?? null,
          forceLog: true,
          diagnostic_payload: {
            function: "runB3SimulationTick",
            provider: priceSrc.provider_name,
            selected_source: priceSrc.source,
            quote_source: priceSrc.quote_source,
            symbol: priceSrc.quote_symbol,
            server: priceSrc.server,
            quote_age_s: priceSrc.quote_age_s,
            bid: priceSrc.raw?.bid ?? null,
            ask: priceSrc.raw?.ask ?? null,
            last: priceSrc.raw?.last ?? null,
          },
        });
        log.push({ mode, action: "skip", reason: "mt5_quote_invalid", detail: invalidMt5 });
        finalizeAudit(invalidMt5);
        continue;
      }

      // ─────────── B3 Protection (Flexibilização Inteligente) ───────────
      const todayKey = b3DayKeyBRT(now);
      // Reset diário se virou o dia.
      if (m.protection_day_key && m.protection_day_key !== todayKey) {
        try {
          await supabase.from("b3_daily_protection_history").upsert({
            user_id: userId, simulation_run_id: runId, simulation_mode_id: m.id, mode,
            day_key: m.protection_day_key,
            target_reached_at: m.target_reached_at,
            block_at: m.protection_state?.startsWith("blocked_") ? m.status_changed_at : null,
            profit_at_target_brl: m.profit_at_target_brl,
            peak_profit_after_target_brl: m.peak_profit_after_target_brl,
            profit_after_target_brl: m.profit_after_target_brl,
            given_back_brl: Math.max(0, Number(m.peak_profit_after_target_brl ?? 0) - Number(m.profit_at_target_brl ?? 0) - Number(m.profit_after_target_brl ?? 0)),
            profit_at_close_brl: null,
            trades_total: m.total_trades,
            trades_after_target: m.trades_after_target,
            drawdown_after_target_brl: Math.max(0, Number(m.peak_profit_after_target_brl ?? 0) - (Number(m.profit_at_target_brl ?? 0) + Number(m.profit_after_target_brl ?? 0))),
            block_reason: m.protection_block_reason,
            final_status: m.protection_state,
          }, { onConflict: "user_id,simulation_run_id,mode,day_key" });
        } catch { /* histórico é best-effort */ }
        const reset = resetB3ProtectionForNewDay();
        Object.assign(m, reset);
      }

      // Deriva trades/consecutive losses pós-meta a partir das ordens fechadas.
      let tradesAfterTarget = Number(m.trades_after_target ?? 0);
      let consecLosses = Number(m.consecutive_losses_after_target ?? 0);
      if (m.target_reached_at) {
        const { data: post } = await supabase.from("b3_simulation_orders")
          .select("net_result_brl, exit_time")
          .eq("simulation_run_id", runId).eq("simulation_mode_id", m.id)
          .eq("status", "closed").gte("exit_time", m.target_reached_at)
          .order("exit_time", { ascending: true });
        tradesAfterTarget = (post ?? []).length;
        consecLosses = 0;
        for (let k = (post ?? []).length - 1; k >= 0; k--) {
          if (Number(post![k].net_result_brl ?? 0) < 0) consecLosses++; else break;
        }
      }

      // Tempo operando hoje (BRT) — a partir das 09:00.
      const opMinutes = Math.max(0, saoPauloMinutes(now) - hhmmToMin(cfg.trading_start_time));

      const protCfg: B3ProtectionSettings = {
        minimum_trades_before_profit_lock: Number(cfg.minimum_trades_before_profit_lock ?? 15),
        minimum_operating_minutes: Number(cfg.minimum_operating_minutes ?? 90),
        profit_multiplier_before_lock: Number(cfg.profit_multiplier_before_lock ?? 2.0),
        post_target_allowed_retracement: Number(cfg.post_target_allowed_retracement ?? 0.30),
        consecutive_loss_after_target: Number(cfg.consecutive_loss_after_target ?? 2),
        post_target_size_reduction: Number(cfg.post_target_size_reduction ?? 0.50),
        daily_loss_limit_brl: Number(cfg.daily_loss_limit_brl),
        daily_gain_target_brl: Number(cfg.daily_gain_target_brl),
        max_volatility_pct: Number(cfg.max_volatility_pct),
      };

      const protCur: B3ProtectionRuntime = {
        protection_state: (m.protection_state as any) ?? "operating_normal",
        target_reached_at: m.target_reached_at ?? null,
        profit_at_target_brl: m.profit_at_target_brl != null ? Number(m.profit_at_target_brl) : null,
        trades_at_target: m.trades_at_target != null ? Number(m.trades_at_target) : null,
        peak_profit_after_target_brl: Number(m.peak_profit_after_target_brl ?? 0),
        profit_after_target_brl: Number(m.profit_after_target_brl ?? 0),
        trades_after_target: tradesAfterTarget,
        consecutive_losses_after_target: consecLosses,
        protection_block_reason: m.protection_block_reason ?? null,
      };

      const protDec = evaluateB3Protection(protCur, protCfg, {
        realized_today_brl: realizedToday,
        total_trades_today: Number(m.total_trades ?? 0),
        operating_minutes_today: opMinutes,
        volatility_pct: ctx.volatility_pct,
        drawdown_hit: false,
        now_iso: now.toISOString(),
      });

      // Persistir runtime de proteção.
      await supabase.from("b3_simulation_modes").update({
        protection_state: protDec.next.protection_state,
        target_reached_at: protDec.next.target_reached_at,
        profit_at_target_brl: protDec.next.profit_at_target_brl,
        trades_at_target: protDec.next.trades_at_target,
        peak_profit_after_target_brl: protDec.next.peak_profit_after_target_brl,
        profit_after_target_brl: protDec.next.profit_after_target_brl,
        trades_after_target: protDec.next.trades_after_target,
        consecutive_losses_after_target: protDec.next.consecutive_losses_after_target,
        protection_block_reason: protDec.next.protection_block_reason,
        protection_day_key: todayKey,
      }).eq("id", m.id);
      Object.assign(m, {
        protection_state: protDec.next.protection_state,
        target_reached_at: protDec.next.target_reached_at,
        profit_at_target_brl: protDec.next.profit_at_target_brl,
        trades_at_target: protDec.next.trades_at_target,
        peak_profit_after_target_brl: protDec.next.peak_profit_after_target_brl,
        profit_after_target_brl: protDec.next.profit_after_target_brl,
        trades_after_target: protDec.next.trades_after_target,
        consecutive_losses_after_target: protDec.next.consecutive_losses_after_target,
        protection_block_reason: protDec.next.protection_block_reason,
        protection_day_key: todayKey,
      });

      if (protDec.transition) {
        try {
          await supabase.from("b3_simulation_block_events").insert({
            simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
            mode,
            prev_status: protDec.transition.from,
            new_status: protDec.transition.to,
            trigger: `protection:${protDec.transition.to}`,
            observed_value: realizedToday,
            limit_value: protCfg.daily_gain_target_brl,
            pnl_at_moment: realizedToday,
            message: protDec.transition.reason,
          });
        } catch { /* best-effort */ }
      }
      // ────────────────── fim B3 Protection ──────────────────

      addCheck("mode_enabled", "Robô habilitado", cfg.enabled !== false, cfg.enabled === false ? "Modo desativado nas configurações." : "habilitado");
      addCheck("volatility", "Volatilidade", ctx.volatility_pct <= Number(cfg.max_volatility_pct), `${ctx.volatility_pct.toFixed(2)}% / limite ${Number(cfg.max_volatility_pct).toFixed(2)}%`);
      addCheck("max_trades", "Máximo trades", !open && 1 <= Number(cfg.max_contracts), open ? "Já existe posição aberta neste robô." : `1 / ${Number(cfg.max_contracts)} contrato(s)`);
      addCheck("daily_loss", "Loss diário", realizedToday > -Number(cfg.daily_loss_limit_brl), `${realizedToday.toFixed(2)} / -${Number(cfg.daily_loss_limit_brl).toFixed(2)} BRL`);
      addCheck("daily_target", "Meta diária", realizedToday < Number(cfg.daily_gain_target_brl) || protDec.allow_new_entry, `${realizedToday.toFixed(2)} / ${Number(cfg.daily_gain_target_brl).toFixed(2)} BRL`);
      addCheck("position_open", "Posição aberta", !open, open ? `ordem ${open.id}` : "NÃO", false);
      addCheck("protection_engine", "Proteção diária", protDec.allow_new_entry, protDec.next.protection_block_reason ?? protDec.next.protection_state);

      if (cfg.enabled === false) {
        await recordStatusIfChanged(mode, m, "pausado", "paused",
          { pnl: realizedToday, message: "Modo desativado nas configurações." });
        log.push({ mode, action: "skip", reason: "modo_desativado" });
        finalizeAudit("Robô desativado nas configurações.");
        continue;
      }

      if (open) {
        if (priceSrc.source === "mt5_xp_demo" && open.quote_source !== "MT5 XP DEMO") {
          await supabase.from("b3_simulation_orders").update({
            status: "cancelled",
            close_reason: "Fonte alterada para MT5 XP DEMO — operação legada invalidada",
          }).eq("id", open.id).eq("user_id", userId);
          openOrdersCache = null;
          log.push({ mode, action: "cancel_legacy_open", reason: "legacy_price_state_invalidated" });
          finalizeAudit("Posição legada aberta foi invalidada antes de nova decisão.");
          continue;
        }
        const dirSign = open.side === "buy" ? 1 : -1;
        let markAudit: B3QuoteExecutionAudit;
        try {
          markAudit = getB3ExecutionAudit(priceSrc, open.side, "mark", "runB3SimulationTick.markToMarket");
          if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(markAudit, "runB3SimulationTick.markToMarket");
          providerStats.last_price_function = markAudit.execution_price_origin;
        } catch (e) {
          await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
            pnl: realizedToday,
            related_order_id: open.id,
            message: (e as Error).message,
            provider_name: priceSrc.provider_name,
            price_source: priceSrc.quote_source,
            rejected_price: ctx.price,
            mt5_last: priceSrc.raw?.last ?? null,
            forceLog: true,
            diagnostic_payload: { function: "runB3SimulationTick.markToMarket", attempted_context_price: ctx.price, ...quoteAuditBase(priceSrc) },
          });
          log.push({ mode, action: "skip", reason: "price_guard", message: (e as Error).message });
          finalizeAudit((e as Error).message);
          continue;
        }
        const markPrice = markAudit.execution_price;
        const movePts = (markPrice - Number(open.entry_price)) * dirSign;
        const hitStop = movePts <= -Number(cfg.stop_pts);
        const hitGain = movePts >= Number(cfg.gain_pts);
        if (forceClose || hitStop || hitGain) {
          const reason = forceClose ? "force_close" : hitStop ? "stop" : "gain";
          await closeOrder(supabase, userId, run, m, open, markAudit, reason);
          providerStats.last_exit_price = markPrice;
          openOrdersCache = null;
          realizedTodayByMode = await getRealizedTodayByMode();
          if (reason === "stop") {
            await recordStatusIfChanged(mode, m, "stop_operacao", "stop_trade",
              { observed: movePts, limit: -Number(cfg.stop_pts), pnl: realizedTodayByMode[mode] ?? 0,
                related_order_id: open.id, message: `Stop da operação atingido (${movePts.toFixed(0)} pts).` });
          }
          log.push({ mode, action: "close", reason, price: markPrice, source: markAudit.quote_source, origin: markAudit.execution_price_origin });
          finalizeAudit(`Posição existente encerrada por ${reason}.`, {
            last_setup: `Posição ${open.side.toUpperCase()} em gestão`,
            signals: { evaluated_side: open.side, buy: false, sell: false },
          });
          continue;
        }
      }

      // Bloqueio de proteção B3 substitui o antigo gate "meta atingida".
      if (!protDec.allow_new_entry) {
        await recordStatusIfChanged(mode, m, protDec.next.protection_state, `protection:${protDec.next.protection_state}`,
          { pnl: realizedToday, message: protDec.next.protection_block_reason ?? "Bloqueio pós-meta." });
        log.push({ mode, action: "skip", reason: protDec.next.protection_state });
        finalizeAudit(protDec.next.protection_block_reason ?? "Proteção global/diária bloqueou nova entrada.");
        continue;
      }

      // Diagnóstico visual: rotula o estado atual (sem bloquear gainHit).
      const lossHit = realizedToday <= -Number(cfg.daily_loss_limit_brl);
      if (lossHit) {
        await recordStatusIfChanged(mode, m, "bloqueado_perda_diaria", "daily_loss",
          { observed: realizedToday, limit: -Number(cfg.daily_loss_limit_brl), pnl: realizedToday,
            message: `Limite diário de perda atingido (${realizedToday.toFixed(2)} BRL).` });
      } else if (forceClose) {
        await recordStatusIfChanged(mode, m, "bloqueado_zeragem", "force_close",
          { pnl: realizedToday, message: "Janela de zeragem obrigatória." });
      } else if (!insideHours) {
        await recordStatusIfChanged(mode, m, "bloqueado_horario", "time",
          { pnl: realizedToday, message: "Fora da janela operacional." });
      } else if (macroBlock) {
        await recordStatusIfChanged(mode, m, "bloqueado_risco", "macro_risk",
          { pnl: realizedToday, message: `Evento macro: ${macroBlock.name}.` });
      } else if (ctx.volatility_pct > Number(cfg.max_volatility_pct)) {
        await recordStatusIfChanged(mode, m, "bloqueado_volatilidade", "volatility",
          { observed: ctx.volatility_pct, limit: Number(cfg.max_volatility_pct), pnl: realizedToday,
            message: `Volatilidade ${ctx.volatility_pct.toFixed(2)}% acima do limite.` });
      } else if (protDec.next.protection_state === "target_reached_observing") {
        await recordStatusIfChanged(mode, m, "target_reached_observing", "protection",
          { pnl: realizedToday, message: "Meta atingida — em observação (size reduzido)." });
      } else if (protDec.next.protection_state === "profit_protected") {
        await recordStatusIfChanged(mode, m, "profit_protected", "protection",
          { pnl: realizedToday, message: "Lucro protegido (size reduzido)." });
      } else {
        await recordStatusIfChanged(mode, m, "operando", "ok",
          { pnl: realizedToday, message: "Operando normalmente." });
      }

      if (!insideHours || forceClose) {
        log.push({ mode, action: "skip", reason: !insideHours ? "fora_horario" : "zeragem" });
        finalizeAudit(!insideHours ? "Fora da janela operacional." : "Janela de zeragem obrigatória.");
        continue;
      }
      if (macroBlock) {
        log.push({ mode, action: "skip", reason: `macro:${macroBlock.name}` });
        await supabase.from("b3_simulation_modes")
          .update({ risk_blocks: (Number(m.risk_blocks) || 0) + 1 }).eq("id", m.id);
        m.risk_blocks = (Number(m.risk_blocks) || 0) + 1;
        finalizeAudit(`Proteção global: evento macro ${macroBlock.name}.`);
        continue;
      }
      if (open) {
        finalizeAudit("Posição já aberta — motor apenas gerencia stop/gain/zeragem.", {
          last_setup: `Posição ${open.side.toUpperCase()} aberta`,
          signals: { evaluated_side: open.side, buy: false, sell: false },
        });
        continue;
      }

      // Se protegido/observando, elevamos o daily_gain_target passado ao Risco
      // para não bloquear por "meta atingida" — a decisão de continuar já foi tomada aqui.
      const inProtectionRun = protDec.next.protection_state === "target_reached_observing"
        || protDec.next.protection_state === "profit_protected";
      const risk: B3RiskState = {
        daily_loss_limit: Number(cfg.daily_loss_limit_brl),
        daily_gain_target: inProtectionRun ? Number.MAX_SAFE_INTEGER : Number(cfg.daily_gain_target_brl),
        realized_today_brl: realizedToday,
        open_contracts: 0,
        max_contracts: Number(cfg.max_contracts),
        requested_qty: 1,
        inside_hours: insideHours,
        force_close_now: forceClose,
        strategy_mode: mode,
      };
      const localCtx = { ...ctx };
      if (localCtx.volatility_pct > Number(cfg.max_volatility_pct)) {
        await supabase.from("b3_simulation_modes")
          .update({ risk_blocks: (Number(m.risk_blocks) || 0) + 1 }).eq("id", m.id);
        m.risk_blocks = (Number(m.risk_blocks) || 0) + 1;
        log.push({ mode, action: "skip", reason: "volatilidade" });
        finalizeAudit("Bloqueado por volatilidade.");
        continue;
      }


      const votes = runB3Agents(localCtx, intendedSide, risk);
      const committee: B3CommitteeSettings = {
        min_approve_votes: Number(cfg.min_approve_votes),
        min_confidence: Number(cfg.min_confidence),
        min_score: Number(cfg.min_score),
      };
      const decision = buildB3Decision(votes, intendedSide, committee);
      addCheck("score", "Score", Number(decision.score) >= Number(cfg.min_score), `${decision.score.toFixed(0)} / mínimo ${Number(cfg.min_score).toFixed(0)}`);
      addCheck("confidence", "Confiança", Number(decision.avg_confidence) >= Number(cfg.min_confidence), `${decision.avg_confidence.toFixed(0)} / mínimo ${Number(cfg.min_confidence).toFixed(0)}`);
      addCheck("committee", "Comitê", decision.final === "approved", decision.justification);
      addCheck("signal_buy", "Sinal BUY", decision.final === "approved" && intendedSide === "buy", intendedSide === "buy" ? decision.final : "lado avaliado SELL", false);
      addCheck("signal_sell", "Sinal SELL", decision.final === "approved" && intendedSide === "sell", intendedSide === "sell" ? decision.final : "lado avaliado BUY", false);

      const voteRows = votes.map(v => ({
        simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
        mode, agent_name: v.agent_name, vote: v.vote, confidence: v.confidence, reason: v.reason,
        market_data_snapshot: {
          snapshot_id: snapIns.id, decision: decision.final, score: decision.score,
          price: ctx.price, side: intendedSide, has_veto: v.has_veto, veto_reason: v.veto_reason ?? null,
        } as any,
      }));
      await supabase.from("b3_simulation_agent_votes").insert(voteRows);

      if (decision.final === "approved") {
        let entryAudit: B3QuoteExecutionAudit;
        try {
          entryAudit = getB3ExecutionAudit(priceSrc, intendedSide, "entry", "runB3SimulationTick.openOrder");
          if (priceSrc.source === "mt5_xp_demo") assertB3StrictMt5ExecutionAudit(entryAudit, "runB3SimulationTick.openOrder");
          providerStats.last_price_function = entryAudit.execution_price_origin;
        } catch (e) {
          await recordStatusIfChanged(mode, m, "erro_tecnico", "price_source_guard", {
            pnl: realizedToday,
            message: (e as Error).message,
            provider_name: priceSrc.provider_name,
            price_source: priceSrc.quote_source,
            rejected_price: ctx.price,
            mt5_last: priceSrc.raw?.last ?? null,
            forceLog: true,
            diagnostic_payload: { function: "runB3SimulationTick.openOrder", attempted_context_price: ctx.price, ...quoteAuditBase(priceSrc) },
          });
          log.push({ mode, action: "blocked", reason: "price_guard", message: (e as Error).message });
          finalizeAudit((e as Error).message, {
            last_analysis: decision.justification,
            last_score: decision.score,
            last_confidence: decision.avg_confidence,
            last_setup: `Setup ${intendedSide.toUpperCase()} aprovado, bloqueado no preço`,
            signals: { evaluated_side: intendedSide, buy: intendedSide === "buy", sell: intendedSide === "sell" },
            committee: decision,
          });
          continue;
        }
        if (priceSrc.source !== "mt5_xp_demo") {
          const slip = Number(run.simulated_slippage_pts) || 0;
          entryAudit = {
            ...entryAudit,
            execution_price: Math.round((intendedSide === "buy" ? entryAudit.execution_price + slip : entryAudit.execution_price - slip) / TICK) * TICK,
            execution_price_origin: `${entryAudit.execution_price_origin}+legacy_slippage`,
          };
        }
        const entry = entryAudit.execution_price;
        const baseQty = 1;
        const qty = Math.max(1, Math.round(baseQty * Math.max(0.05, protDec.size_multiplier)));
        const { error: oErr } = await supabase.from("b3_simulation_orders").insert({
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
          mode, symbol: "WIN", contract_code: "WINFUT", side: intendedSide,
          entry_price: Math.round(entry / TICK) * TICK, quantity: qty,
          fees: Number(run.simulated_fee_brl) || 0, status: "open",
          ...orderAuditPatch(entryAudit),
        });
        if (oErr) throw oErr;
        providerStats.last_entry_price = entry;
        openOrdersCache = null;
        await supabase.from("b3_simulation_modes")
          .update({
            committee_approvals: (Number(m.committee_approvals) || 0) + 1,
            contracts_traded: (Number(m.contracts_traded) || 0) + 1,
          }).eq("id", m.id);
        m.committee_approvals = (Number(m.committee_approvals) || 0) + 1;
        m.contracts_traded = (Number(m.contracts_traded) || 0) + 1;
        log.push({ mode, action: "open", side: intendedSide, price: entry, score: decision.score, source: entryAudit.quote_source, origin: entryAudit.execution_price_origin });
        finalizeAudit(`Setup ${intendedSide.toUpperCase()} aprovado e ordem simulada aberta.`, {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: `Setup ${intendedSide.toUpperCase()}`,
          signals: { evaluated_side: intendedSide, buy: intendedSide === "buy", sell: intendedSide === "sell" },
          committee: decision,
        });
      } else {
        const field = decision.final === "blocked" ? "risk_blocks" : "committee_rejections";
        await supabase.from("b3_simulation_modes")
          .update({ [field]: (Number(m[field]) || 0) + 1 }).eq("id", m.id);
        m[field] = (Number(m[field]) || 0) + 1;
        log.push({ mode, action: "reject", final: decision.final, score: decision.score });
        finalizeAudit(finalReasonFromDecision(decision, committee), {
          last_analysis: decision.justification,
          last_score: decision.score,
          last_confidence: decision.avg_confidence,
          last_setup: "Nenhum setup aprovado",
          signals: { evaluated_side: intendedSide, buy: false, sell: false },
          committee: decision,
        });
      }
    }
    snapshotExtra.engine_audit = tickAudit;
    await supabase.from("b3_simulation_market_snapshots")
      .update({ extra: snapshotExtra })
      .eq("id", snapIns.id)
      .eq("user_id", userId);
    log.push({ action: "engine_audit", snapshot_id: snapIns.id, modes: tickAudit.modes.map((m: any) => ({ mode: m.mode, final_reason: m.last_refusal_reason, first_stop: m.first_stop?.label ?? null })) });
  }

  return { ok: true, processed: ticks, log: [{ action: "provider_diagnostic", ...providerStats }, ...log] };
}

export const tickB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; ticks?: number }) => d)
  .handler(async ({ data, context }) => {
    return runB3SimulationTick(context.supabase, context.userId, data.run_id, data.ticks ?? 1);
  });

export const getB3EngineDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: runs } = await (supabase as any).from("b3_simulation_runs")
      .select("*").eq("user_id", userId).in("status", ["running", "paused"])
      .order("started_at", { ascending: false }).limit(1);
    const run = runs?.[0] ?? null;
    if (!run) return { run: null, audit: null, snapshot: null, settings: [], price_source: null };
    const [{ data: snapshot }, { data: settings }, { data: tradeSettings }] = await Promise.all([
      (supabase as any).from("b3_simulation_market_snapshots").select("*")
        .eq("simulation_run_id", run.id).eq("user_id", userId).order("market_time", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("b3_simulation_mode_settings").select("*")
        .eq("simulation_run_id", run.id).eq("user_id", userId),
      (supabase as any).from("b3_trading_settings").select("price_source")
        .eq("user_id", userId).maybeSingle(),
    ]);
    return {
      run,
      snapshot: snapshot ?? null,
      audit: (snapshot?.extra as any)?.engine_audit ?? null,
      settings: settings ?? [],
      price_source: tradeSettings?.price_source ?? "csv",
    };
  });

// ─────────────────── Pipeline de Diagnóstico (read-only) ───────────────────
// Agrega os últimos snapshots com engine_audit e produz, por robô:
//   - a última execução do pipeline (etapas ordenadas com valor observado × limite)
//   - contadores (ticks, entradas analisadas, bloqueadas, autorizadas, buy/sell, ordens)
//   - histórico dos últimos 100 bloqueios
// NÃO altera regras nem parâmetros — só lê snapshots já existentes.
const PIPELINE_STEP_ORDER = [
  "tick_received",
  "valid_quote",
  "mt5_server",
  "mt5_symbol",
  "market_open",
  "time_allowed",
  "operation_window",
  "force_close_window",
  "spread",
  "global_protection",
  "mode_enabled",
  "volatility",
  "max_trades",
  "daily_loss",
  "daily_target",
  "position_open",
  "protection_engine",
  "score",
  "confidence",
  "committee",
  "signal_buy",
  "signal_sell",
] as const;

export const getB3PipelineAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: runs } = await (supabase as any).from("b3_simulation_runs")
      .select("id, status, started_at").eq("user_id", userId)
      .in("status", ["running", "paused"])
      .order("started_at", { ascending: false }).limit(1);
    const run = runs?.[0] ?? null;
    if (!run) return { run: null, modes: [], history: [], totals: null };

    const { data: snaps } = await (supabase as any).from("b3_simulation_market_snapshots")
      .select("id, market_time, extra")
      .eq("simulation_run_id", run.id).eq("user_id", userId)
      .order("market_time", { ascending: false })
      .limit(200);

    const list = (snaps ?? []).filter((s: any) => s?.extra?.engine_audit);

    // contadores por robô
    const perMode: Record<string, any> = {};
    for (const mode of MODES) {
      perMode[mode] = {
        mode,
        ticks_received: 0,
        ticks_valid: 0,
        entries_analyzed: 0,
        entries_blocked: 0,
        entries_authorized: 0,
        buy_signals: 0,
        sell_signals: 0,
        orders_executed: 0,
        last_reason: null,
        last_step_blocked: null,
        last_pipeline: [] as any[],
        last_snapshot_at: null,
        last_tick: null,
        last_score: null,
        last_confidence: null,
        last_setup: null,
      };
    }
    const history: any[] = [];

    // snapshots vêm em ordem decrescente; iterar reverso para popular "last_*" corretamente
    for (const s of [...list].reverse()) {
      const audit = s.extra.engine_audit;
      const tick = audit.last_tick ?? null;
      for (const m of audit.modes ?? []) {
        const bucket = perMode[m.mode];
        if (!bucket) continue;
        bucket.ticks_received += 1;
        const guardOk = audit.tick_guard ? audit.tick_guard.ok !== false : true;
        if (guardOk && !audit.global_protection?.active) bucket.ticks_valid += 1;
        bucket.entries_analyzed += 1;
        const approved = /aprovado/i.test(m.last_refusal_reason ?? "") && !/bloqueado/i.test(m.last_refusal_reason ?? "");
        const opened = /ordem simulada aberta/i.test(m.last_refusal_reason ?? "");
        if (opened) { bucket.entries_authorized += 1; bucket.orders_executed += 1; }
        else bucket.entries_blocked += 1;
        if (m.signals?.buy) bucket.buy_signals += 1;
        if (m.signals?.sell) bucket.sell_signals += 1;

        bucket.last_reason = m.last_refusal_reason ?? bucket.last_reason;
        bucket.last_step_blocked = m.first_stop ?? bucket.last_step_blocked;
        bucket.last_snapshot_at = s.market_time;
        bucket.last_tick = tick;
        bucket.last_score = m.last_score ?? bucket.last_score;
        bucket.last_confidence = m.last_confidence ?? bucket.last_confidence;
        bucket.last_setup = m.last_setup ?? bucket.last_setup;

        const byKey: Record<string, any> = {};
        for (const c of m.checks ?? []) byKey[c.key] = c;
        bucket.last_pipeline = PIPELINE_STEP_ORDER
          .filter((k) => byKey[k])
          .map((k) => byKey[k]);

        if (!opened && m.first_stop) {
          history.push({
            at: s.market_time,
            mode: m.mode,
            step: m.first_stop.label,
            step_key: m.first_stop.key,
            detail: m.first_stop.detail,
            reason: m.last_refusal_reason,
          });
        }
      }
    }

    history.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return {
      run,
      modes: MODES.map((m) => perMode[m]),
      history: history.slice(0, 100),
      totals: {
        snapshots_scanned: list.length,
      },
    };
  });




async function closeOrder(supabase: any, userId: string, run: any, mode: any, order: any, exitAudit: B3QuoteExecutionAudit, reason: string) {
  if (exitAudit.quote_source === "MT5 XP DEMO") assertB3StrictMt5ExecutionAudit(exitAudit, "closeOrder");
  const exitPrice = exitAudit.execution_price;
  const dir = order.side === "buy" ? 1 : -1;
  const grossPts = (exitPrice - Number(order.entry_price)) * dir;
  const qty = Number(order.quantity) || 1;
  const grossBrl = grossPts * POINT_VALUE_BRL * qty;
  const fees = (Number(run.simulated_fee_brl) || 0) * 2 * qty; // round-trip
  const netBrl = grossBrl - fees;

  await supabase.from("b3_simulation_orders").update({
    exit_price: Math.round(exitPrice / TICK) * TICK,
    exit_time: new Date().toISOString(),
    gross_result_points: grossPts,
    gross_result_brl: grossBrl,
    fees, net_result_brl: netBrl,
    status: "closed", close_reason: reason,
    quote_source: exitAudit.quote_source,
    quote_server: exitAudit.quote_server,
    quote_symbol: exitAudit.quote_symbol,
    quote_tick_ts: exitAudit.quote_tick_ts,
    quote_bid: exitAudit.quote_bid,
    quote_ask: exitAudit.quote_ask,
    quote_last: exitAudit.quote_last,
    execution_price: exitAudit.execution_price,
    execution_price_origin: exitAudit.execution_price_origin,
    legacy_price_detected: exitAudit.legacy_price_detected,
    provider_name: exitAudit.provider_name,
  }).eq("id", order.id).eq("user_id", userId);

  const newRealized = Number(mode.realized_pnl) + netBrl;
  const newBalance = Number(mode.current_balance) + netBrl;
  const wins = Number(mode.winning_trades) + (netBrl > 0 ? 1 : 0);
  const losses = Number(mode.losing_trades) + (netBrl < 0 ? 1 : 0);
  const maxGain = Math.max(Number(mode.max_gain) || 0, netBrl);
  const maxLoss = Math.min(Number(mode.max_loss) || 0, netBrl);
  const peak = Number(mode.initial_balance) + Math.max(0, newRealized);
  const dd = Math.max(Number(mode.max_drawdown) || 0, peak - newBalance);
  const totalPts = Number(mode.points_result) + grossPts;

  await supabase.from("b3_simulation_modes").update({
    realized_pnl: newRealized,
    current_balance: newBalance,
    total_fees: Number(mode.total_fees) + fees,
    total_trades: Number(mode.total_trades) + 1,
    winning_trades: wins, losing_trades: losses,
    max_gain: maxGain, max_loss: maxLoss, max_drawdown: dd,
    points_result: totalPts,
  }).eq("id", mode.id);

  mode.realized_pnl = newRealized; mode.current_balance = newBalance;
  mode.total_fees = Number(mode.total_fees) + fees;
  mode.total_trades = Number(mode.total_trades) + 1;
  mode.winning_trades = wins; mode.losing_trades = losses;
  mode.max_gain = maxGain; mode.max_loss = maxLoss; mode.max_drawdown = dd;
  mode.points_result = totalPts;
}

// ───────────────────── macro events ─────────────────────
export const listB3MacroEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("b3_macro_events")
      .select("*").eq("user_id", userId).order("block_start", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const upsertB3MacroEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; name: string; category?: string; block_start: string; block_end: string; severity?: "low"|"medium"|"high"; active?: boolean; notes?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row: any = {
      user_id: userId, name: data.name, category: data.category ?? "macro",
      block_start: data.block_start, block_end: data.block_end,
      severity: data.severity ?? "high", active: data.active ?? true, notes: data.notes ?? null,
    };
    if (data.id) {
      const { error } = await (supabase as any).from("b3_macro_events").update(row).eq("id", data.id).eq("user_id", userId);
      if (error) throw error;
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await (supabase as any).from("b3_macro_events").insert(row).select("id").single();
    if (error) throw error;
    return { ok: true, id: ins.id };
  });

export const deleteB3MacroEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase as any).from("b3_macro_events").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// ───────────────────── ranking / sugestão ─────────────────────
export function scoreMode(m: any) {
  const net = Number(m.realized_pnl) || 0;
  const dd = Math.max(1, Number(m.max_drawdown) || 0);
  const trades = Math.max(1, Number(m.total_trades) || 0);
  const winRate = (Number(m.winning_trades) || 0) / trades;
  const rr = net / dd;
  const blocks = Number(m.risk_blocks) || 0;
  // peso: lucro líquido normalizado + taxa de acerto + r/r - drawdown - blocks
  const norm = net / Math.max(1000, Number(m.initial_balance) * 0.05);
  return 0.40 * norm + 0.25 * (winRate * 4) + 0.20 * Math.max(-2, Math.min(2, rr)) - 0.10 * (dd / 1000) - 0.05 * (blocks / 10);
}

// ───────────────────── settings por modo ─────────────────────
export const listB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any).from("b3_simulation_mode_settings")
      .select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    // garantir 3 linhas
    const byMode: Record<string, any> = {};
    for (const r of rows ?? []) byMode[r.mode] = r;
    const missing = MODES.filter(m => !byMode[m]);
    if (missing.length) {
      const ins = missing.map(m => ({
        simulation_run_id: data.run_id, user_id: userId, mode: m, ...MODE_DEFAULTS[m],
      }));
      const { data: created } = await (supabase as any).from("b3_simulation_mode_settings").insert(ins).select("*");
      for (const r of created ?? []) byMode[r.mode] = r;
    }
    return MODES.map(m => byMode[m]);
  });

const SETTING_FIELDS = [
  "enabled","min_approve_votes","min_confidence","min_score","max_contracts",
  "stop_pts","gain_pts","max_volatility_pct","daily_loss_limit_brl","daily_gain_target_brl",
  "trading_start_time","entry_cutoff_time","force_close_time","notes",
  // B3 Protection
  "minimum_trades_before_profit_lock","minimum_operating_minutes","profit_multiplier_before_lock",
  "post_target_allowed_retracement","consecutive_loss_after_target","post_target_size_reduction",
] as const;

export const updateB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode; patch: Record<string, any> }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, any> = {};
    for (const k of SETTING_FIELDS) if (k in data.patch) patch[k] = data.patch[k];
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update(patch).eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const resetB3ModeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; mode: Mode }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const def = MODE_DEFAULTS[data.mode];
    const { error } = await (supabase as any).from("b3_simulation_mode_settings")
      .update({ ...def, enabled: true })
      .eq("simulation_run_id", data.run_id).eq("mode", data.mode).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

// ───────────────────── B3 Protection: state & history ─────────────────────
export const getB3ProtectionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any).from("b3_simulation_modes")
      .select("id, mode, protection_state, target_reached_at, profit_at_target_brl, trades_at_target, peak_profit_after_target_brl, profit_after_target_brl, trades_after_target, consecutive_losses_after_target, protection_block_reason, protection_day_key, total_trades, realized_pnl")
      .eq("simulation_run_id", data.run_id).eq("user_id", userId);
    if (error) throw error;
    return rows ?? [];
  });

export const listB3ProtectionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from?: string; to?: string; mode?: Mode; run_id?: string; limit?: number }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = (supabase as any).from("b3_daily_protection_history")
      .select("*").eq("user_id", userId)
      .order("day_key", { ascending: false })
      .limit(Math.min(500, Math.max(1, Number(data.limit ?? 200))));
    if (data.from) q = q.gte("day_key", data.from);
    if (data.to) q = q.lte("day_key", data.to);
    if (data.mode) q = q.eq("mode", data.mode);
    if (data.run_id) q = q.eq("simulation_run_id", data.run_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });
