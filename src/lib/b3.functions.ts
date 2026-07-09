// B3 Day Trade — server functions (Fase 2: comitê e votos)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";
import { getB3PriceContext, type B3PriceSource } from "./b3-price-source.server";


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

    const ctx = buildMockB3Context(
      data.symbol ?? "WIN",
      data.contract_code ?? "WINFUT",
      data.base_price ?? 130000,
    );

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
