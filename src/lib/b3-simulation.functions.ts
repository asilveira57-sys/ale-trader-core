// B3 Day Trade — Fase 2.5: simulação comparativa dos 3 modos
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildMockB3Context, runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";
import {
  evaluateB3Protection, resetB3ProtectionForNewDay, b3DayKeyBRT,
  type B3ProtectionRuntime, type B3ProtectionSettings,
} from "./b3-protection.server";

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
    const [runR, modesR, ordersR, snapsR] = await Promise.all([
      (supabase as any).from("b3_simulation_runs").select("*").eq("id", data.run_id).eq("user_id", userId).maybeSingle(),
      (supabase as any).from("b3_simulation_modes").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId),
      (supabase as any).from("b3_simulation_orders").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("created_at", { ascending: false }).limit(500),
      (supabase as any).from("b3_simulation_market_snapshots").select("*").eq("simulation_run_id", data.run_id).eq("user_id", userId).order("market_time", { ascending: false }).limit(120),
    ]);
    if (runR.error) throw runR.error;
    if (!runR.data) throw new Error("Run não encontrada");
    return {
      run: runR.data,
      modes: modesR.data ?? [],
      orders: ordersR.data ?? [],
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

  // Helper: registra mudança de status operacional (parou de operar / voltou)
  async function recordStatusIfChanged(
    mode: string, m: any, newStatus: string, trigger: string,
    opts: { observed?: number; limit?: number; pnl?: number; related_order_id?: string; message?: string } = {},
  ) {
    const prev = m.current_status ?? "operando";
    if (prev === newStatus) return;
    await supabase.from("b3_simulation_block_events").insert({
      simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
      mode, prev_status: prev, new_status: newStatus, trigger,
      observed_value: opts.observed ?? null,
      limit_value: opts.limit ?? null,
      pnl_at_moment: opts.pnl ?? null,
      related_order_id: opts.related_order_id ?? null,
      message: opts.message ?? null,
    });
    await supabase.from("b3_simulation_modes").update({
      current_status: newStatus, status_reason: opts.message ?? null,
      status_changed_at: new Date().toISOString(), last_trigger: trigger,
    }).eq("id", m.id);
    m.current_status = newStatus;
    m.status_reason = opts.message ?? null;
    m.status_changed_at = new Date().toISOString();
    m.last_trigger = trigger;
  }


  for (let i = 0; i < ticks; i++) {
    const now = new Date();
    const cur = saoPauloMinutes(now);

    const ctx = buildMockB3Context("WIN", "WINFUT", 130000);
    const { data: snapIns, error: sErr } = await supabase.from("b3_simulation_market_snapshots")
      .insert({
        simulation_run_id: runId, user_id: userId, symbol: "WIN",
        price: ctx.price, candle_open: ctx.open, candle_high: ctx.high, candle_low: ctx.low,
        candle_close: ctx.price, volume: ctx.volume_ratio, vwap: ctx.vwap,
        market_time: now.toISOString(), source: "mock",
        extra: { ema9: ctx.ema9, ema21: ctx.ema21, rsi: ctx.rsi, macd: ctx.macd, macd_signal: ctx.macd_signal,
          momentum: ctx.momentum, volatility_pct: ctx.volatility_pct, session_phase: ctx.session_phase },
      }).select("id").single();
    if (sErr) throw sErr;

    const macroBlock = (macros ?? []).find((m: any) => {
      const a = new Date(m.block_start).getTime();
      const b = new Date(m.block_end).getTime();
      return now.getTime() >= a && now.getTime() <= b;
    });

    const intendedSide: B3Side = ctx.ema9 >= ctx.ema21 ? "buy" : "sell";

    for (const mode of MODES) {
      const m = modeByName[mode];
      if (!m) continue;
      const cfg = settingsByMode[mode];
      const realizedToday = Number(realizedTodayByMode[mode] ?? 0);

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

      if (cfg.enabled === false) {
        await recordStatusIfChanged(mode, m, "pausado", "paused",
          { pnl: realizedToday, message: "Modo desativado nas configurações." });
        log.push({ mode, action: "skip", reason: "modo_desativado" });
        continue;
      }

      const startMin = hhmmToMin(cfg.trading_start_time);
      const cutoffMin = hhmmToMin(cfg.entry_cutoff_time);
      const forceMin = hhmmToMin(cfg.force_close_time);
      const insideHours = cur >= startMin && cur <= cutoffMin;
      const forceClose = cur >= forceMin || cur < startMin;

      const openList = await getOpen();
      const open = (openList ?? []).find((o: any) => o.simulation_mode_id === m.id);
      if (open) {
        const dirSign = open.side === "buy" ? 1 : -1;
        const movePts = (ctx.price - Number(open.entry_price)) * dirSign;
        const hitStop = movePts <= -Number(cfg.stop_pts);
        const hitGain = movePts >= Number(cfg.gain_pts);
        if (forceClose || hitStop || hitGain) {
          const reason = forceClose ? "force_close" : hitStop ? "stop" : "gain";
          await closeOrder(supabase, userId, run, m, open, ctx.price, reason);
          openOrdersCache = null;
          realizedTodayByMode = await getRealizedTodayByMode();
          if (reason === "stop") {
            await recordStatusIfChanged(mode, m, "stop_operacao", "stop_trade",
              { observed: movePts, limit: -Number(cfg.stop_pts), pnl: realizedTodayByMode[mode] ?? 0,
                related_order_id: open.id, message: `Stop da operação atingido (${movePts.toFixed(0)} pts).` });
          }
          log.push({ mode, action: "close", reason, price: ctx.price });
          continue;
        }
      }

      // Bloqueio de proteção B3 substitui o antigo gate "meta atingida".
      if (!protDec.allow_new_entry) {
        await recordStatusIfChanged(mode, m, protDec.next.protection_state, `protection:${protDec.next.protection_state}`,
          { pnl: realizedToday, message: protDec.next.protection_block_reason ?? "Bloqueio pós-meta." });
        log.push({ mode, action: "skip", reason: protDec.next.protection_state });
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
        continue;
      }
      if (macroBlock) {
        log.push({ mode, action: "skip", reason: `macro:${macroBlock.name}` });
        await supabase.from("b3_simulation_modes")
          .update({ risk_blocks: (Number(m.risk_blocks) || 0) + 1 }).eq("id", m.id);
        m.risk_blocks = (Number(m.risk_blocks) || 0) + 1;
        continue;
      }
      if (open) continue;

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
        continue;
      }


      const votes = runB3Agents(localCtx, intendedSide, risk);
      const committee: B3CommitteeSettings = {
        min_approve_votes: Number(cfg.min_approve_votes),
        min_confidence: Number(cfg.min_confidence),
        min_score: Number(cfg.min_score),
      };
      const decision = buildB3Decision(votes, intendedSide, committee);

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
        const slip = Number(run.simulated_slippage_pts) || 0;
        const entry = intendedSide === "buy" ? ctx.price + slip : ctx.price - slip;
        const { error: oErr } = await supabase.from("b3_simulation_orders").insert({
          simulation_run_id: runId, simulation_mode_id: m.id, user_id: userId,
          mode, symbol: "WIN", contract_code: "WINFUT", side: intendedSide,
          entry_price: Math.round(entry / TICK) * TICK, quantity: 1,
          fees: Number(run.simulated_fee_brl) || 0, status: "open",
        });
        if (oErr) throw oErr;
        openOrdersCache = null;
        await supabase.from("b3_simulation_modes")
          .update({
            committee_approvals: (Number(m.committee_approvals) || 0) + 1,
            contracts_traded: (Number(m.contracts_traded) || 0) + 1,
          }).eq("id", m.id);
        m.committee_approvals = (Number(m.committee_approvals) || 0) + 1;
        m.contracts_traded = (Number(m.contracts_traded) || 0) + 1;
        log.push({ mode, action: "open", side: intendedSide, price: entry, score: decision.score });
      } else {
        const field = decision.final === "blocked" ? "risk_blocks" : "committee_rejections";
        await supabase.from("b3_simulation_modes")
          .update({ [field]: (Number(m[field]) || 0) + 1 }).eq("id", m.id);
        m[field] = (Number(m[field]) || 0) + 1;
        log.push({ mode, action: "reject", final: decision.final, score: decision.score });
      }
    }
  }

  return { ok: true, processed: ticks, log };
}

export const tickB3Simulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; ticks?: number }) => d)
  .handler(async ({ data, context }) => {
    return runB3SimulationTick(context.supabase, context.userId, data.run_id, data.ticks ?? 1);
  });


async function closeOrder(supabase: any, userId: string, run: any, mode: any, order: any, exitPrice: number, reason: string) {
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
