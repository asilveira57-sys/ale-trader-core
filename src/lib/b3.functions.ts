// B3 Day Trade — server functions (Fase 2: comitê e votos)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildMockB3Context, runB3Agents, buildB3Decision,
  type B3Side, type B3RiskState, type B3CommitteeSettings,
} from "./b3-committee.server";

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
      },
    }));
    const { error: insErr } = await supabase.from("b3_agent_votes").insert(rowsToInsert);
    if (insErr) throw insErr;

    return {
      decision,
      votes,
      context: {
        price: ctx.price, vwap: ctx.vwap, ema9: ctx.ema9, ema21: ctx.ema21,
        rsi: ctx.rsi, macd: ctx.macd, macd_signal: ctx.macd_signal,
        volume_ratio: ctx.volume_ratio, volatility_pct: ctx.volatility_pct,
        momentum: ctx.momentum, session_phase: ctx.session_phase,
      },
      risk,
      committee,
    };
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
