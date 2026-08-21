// B3LegacyRobotMt5Adapter — permite que o motor legado (B3 Day Trade WIN)
// rode consumindo o tick real do MT5 (XPMT5-DEMO / XPMT5-PRD) sobre WINQ26.
// Reusa runB3Agents + buildB3Decision. Não envia ordem real em hipótese alguma.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runB3Agents,
  buildB3Decision,
  type B3Context,
  type B3Side,
  type B3RiskState,
  type B3CommitteeSettings,
  type B3AgentVote,
} from "./b3-committee.server";

// WINQ26 — tick size, valor por ponto, valor por tick.
export const WIN_TICK_SIZE = 5;
export const WIN_POINT_VALUE_BRL = 0.2; // R$ 1,00 por tick de 5 pts => 0,20/ponto
export const TICK_ENTRY_MAX_AGE_S = 5;
export const TICK_PAUSE_AGE_S = 30;

export const LEGACY_MODES = ["conservador", "moderado", "equilibrado", "semi_agressivo", "agressivo"] as const;
export type LegacyMode = (typeof LEGACY_MODES)[number];

interface LegacyModeCfg {
  min_approve_votes: number; min_confidence: number; min_score: number;
  max_contracts: number; stop_pts: number; gain_pts: number; max_volatility_pct: number;
  /** Piso de volatilidade (portão de lateralidade) — equivale a lateral_vol_min. */
  lateral_vol_min: number;
  /** Força de tendência mínima — repassada aos agentes para auditoria. */
  lateral_strength_min: number;
  daily_loss_limit_brl: number; daily_gain_target_brl: number;
}
const LEGACY_DEFAULTS: Record<LegacyMode, LegacyModeCfg> = {
  conservador:    { min_approve_votes: 6, min_confidence: 70, min_score: 75, max_contracts: 1, stop_pts: 100, gain_pts: 200, max_volatility_pct: 2.5, lateral_vol_min: 0.6, lateral_strength_min: 30, daily_loss_limit_brl: 100, daily_gain_target_brl: 200 },
  moderado:       { min_approve_votes: 5, min_confidence: 62, min_score: 65, max_contracts: 2, stop_pts: 150, gain_pts: 300, max_volatility_pct: 3.5, lateral_vol_min: 0.5, lateral_strength_min: 30, daily_loss_limit_brl: 300, daily_gain_target_brl: 500 },
  equilibrado:    { min_approve_votes: 5, min_confidence: 70, min_score: 62, max_contracts: 3, stop_pts: 220, gain_pts: 440, max_volatility_pct: 3.8, lateral_vol_min: 0.45, lateral_strength_min: 30, daily_loss_limit_brl: 500, daily_gain_target_brl: 700 },
  semi_agressivo: { min_approve_votes: 5, min_confidence: 60, min_score: 60, max_contracts: 4, stop_pts: 300, gain_pts: 600, max_volatility_pct: 4.0, lateral_vol_min: 0.4, lateral_strength_min: 28, daily_loss_limit_brl: 800, daily_gain_target_brl: 1000 },
  agressivo:      { min_approve_votes: 4, min_confidence: 55, min_score: 55, max_contracts: 3, stop_pts: 200, gain_pts: 400, max_volatility_pct: 4.5, lateral_vol_min: 0.35, lateral_strength_min: 25, daily_loss_limit_brl: 600, daily_gain_target_brl: 1200 },
};


interface Quote {
  bid: number | null; ask: number | null; last: number | null;
  spread: number | null; volume: number | null; server: string | null;
  received_at: string; tick_ts: string | null; symbol: string;
}
interface Candle {
  minute_ts: string; open: number; high: number; low: number; close: number;
  volume: number; tick_count: number;
}

function saoPauloMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}
function sessionPhase(d: Date): B3Context["session_phase"] {
  const m = saoPauloMinutes(d);
  if (m < 9 * 60 + 5 || m > 17 * 60 + 55) return "fora";
  if (m < 9 * 60 + 30) return "abertura";
  if (m < 12 * 60) return "manha";
  if (m < 14 * 60) return "almoco";
  if (m < 17 * 60) return "tarde";
  return "fechamento";
}
function minuteBucket(d: Date): string {
  const t = new Date(d);
  t.setUTCSeconds(0, 0);
  return t.toISOString();
}
function hhmmToMin(s: string) { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; }

/** Atualiza (upsert) o candle M1 corrente a partir do tick e retorna a lista dos últimos N. */
export async function updateM1Candle(
  sb: SupabaseClient, userId: string, quote: Quote, lookback = 30,
): Promise<{ current: Candle; recent: Candle[] }> {
  const ref = Number(quote.last ?? ((quote.bid && quote.ask) ? (Number(quote.bid) + Number(quote.ask)) / 2 : (quote.bid ?? quote.ask)));
  const ts = quote.tick_ts ? new Date(quote.tick_ts) : new Date(quote.received_at);
  const bucket = minuteBucket(ts);
  const vol = Number(quote.volume ?? 0);

  const { data: existing } = await (sb as any).from("b3_legacy_mt5_candles")
    .select("*").eq("user_id", userId).eq("symbol", quote.symbol).eq("minute_ts", bucket).maybeSingle();

  let row: Candle;
  if (!existing) {
    const inserted = {
      user_id: userId, symbol: quote.symbol, minute_ts: bucket,
      open: ref, high: ref, low: ref, close: ref,
      volume: vol, tick_count: 1, server: quote.server ?? null,
    };
    await (sb as any).from("b3_legacy_mt5_candles").insert(inserted);
    row = { minute_ts: bucket, open: ref, high: ref, low: ref, close: ref, volume: vol, tick_count: 1 };
  } else {
    const upd = {
      high: Math.max(Number(existing.high), ref),
      low: Math.min(Number(existing.low), ref),
      close: ref,
      volume: Number(existing.volume) + Math.max(0, vol),
      tick_count: Number(existing.tick_count) + 1,
      updated_at: new Date().toISOString(),
    };
    await (sb as any).from("b3_legacy_mt5_candles").update(upd).eq("id", existing.id);
    row = { minute_ts: bucket, open: Number(existing.open), high: upd.high, low: upd.low, close: upd.close, volume: upd.volume, tick_count: upd.tick_count };
  }

  const { data: recent } = await (sb as any).from("b3_legacy_mt5_candles")
    .select("minute_ts, open, high, low, close, volume, tick_count")
    .eq("user_id", userId).eq("symbol", quote.symbol)
    .order("minute_ts", { ascending: false }).limit(lookback);

  const list = ((recent as Candle[]) ?? []).slice().reverse();
  if (!list.length) list.push(row);
  return { current: row, recent: list };
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** Constrói o B3Context (formato esperado pelos robôs antigos) a partir do tick MT5 + candles M1. */
export function buildB3ContextFromMt5Tick(
  quote: Quote, candles: Candle[], symbol = "WIN", contract = "WINFUT",
): B3Context {
  const closes = candles.map((c) => Number(c.close));
  const last = Number(quote.last ?? closes[closes.length - 1] ?? 0);
  const cur = candles[candles.length - 1] ?? { open: last, high: last, low: last, close: last, volume: 0, tick_count: 0 };
  const prev = candles.length > 1 ? candles[candles.length - 2] : cur;

  const e9 = ema(closes.slice(-30), 9);
  const e21 = ema(closes.slice(-30), 21);
  const macdLine = ema(closes, 12) - ema(closes, 26);
  const macdSig = ema(closes.slice(-9), 9); // aproximação (série curta)
  const rsiVal = rsi(closes, 14);

  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));
  const dayHigh = highs.length ? Math.max(...highs) : last;
  const dayLow = lows.length ? Math.min(...lows) : last;
  const volAvg = candles.length ? candles.reduce((s, c) => s + Number(c.volume), 0) / candles.length : 1;
  const vwap = candles.length
    ? candles.reduce((s, c) => s + ((Number(c.high) + Number(c.low) + Number(c.close)) / 3) * Number(c.volume || 1), 0)
      / Math.max(1, candles.reduce((s, c) => s + Number(c.volume || 1), 0))
    : last;

  const ranges = candles.slice(-14).map((c) => Number(c.high) - Number(c.low));
  const atr = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
  const volatility_pct = last > 0 ? (atr / last) * 100 : 0;

  const momentum = prev ? ((last - Number(prev.close)) / Math.max(1, Number(prev.close))) * 1000 : 0;
  const spread_pts = Number(quote.spread ?? ((quote.bid && quote.ask) ? Number(quote.ask) - Number(quote.bid) : 5));

  return {
    symbol, contract_code: contract,
    price: last,
    prev_close: prev ? Number(prev.close) : last,
    open: Number(cur.open),
    high: dayHigh,
    low: dayLow,
    vwap,
    ema9: e9,
    ema21: e21,
    rsi: rsiVal,
    macd: macdLine,
    macd_signal: macdSig,
    volume_ratio: volAvg > 0 ? Number(cur.volume) / volAvg : 1,
    volatility_pct,
    momentum,
    spread_pts,
    now: new Date(),
    session_phase: sessionPhase(new Date()),
  };
}

/** Guard hard: nunca envia ordem real quando o motor legado está ativo em modo simulação. */
export async function assertNoRealOrderIfLegacyActive(
  sb: SupabaseClient, userId: string, source: string, action: string, payload: unknown,
) {
  const { data: settings } = await (sb as any).from("b3_mt5sim_settings").select("engine").eq("user_id", userId).maybeSingle();
  const engine = settings?.engine ?? "legacy_b3";
  if (engine === "legacy_b3") {
    await (sb as any).from("b3_mt5sim_order_attempts").insert({
      user_id: userId, source, action, payload: payload as any,
      blocked: true, reason: "Tentativa de ordem real bloqueada — modo MT5 Simulação com Motor Legado ativo",
    });
    throw new Error("Tentativa de ordem real bloqueada — modo MT5 Simulação com Motor Legado ativo");
  }
}

interface Settings {
  mt5_symbol: string; session_start: string; session_end: string;
  quote_ttl_seconds: number; slippage_ticks: number; fee_per_contract_brl: number;
  engine: string;
}

async function realizedTodayByMode(sb: SupabaseClient, userId: string): Promise<Record<string, number>> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const startUtcIso = `${parts}T03:00:00.000Z`;
  const { data: closedToday } = await (sb as any).from("b3_legacy_mt5_trades")
    .select("mode, net_brl, closed_at").eq("user_id", userId).eq("status", "closed").gte("closed_at", startUtcIso);
  const map: Record<string, number> = { conservador: 0, moderado: 0, equilibrado: 0, semi_agressivo: 0, agressivo: 0 };
  for (const r of (closedToday as any[]) ?? []) map[r.mode] = (map[r.mode] || 0) + Number(r.net_brl ?? 0);
  return map;
}

async function closeLegacyTrade(sb: SupabaseClient, userId: string, s: Settings, trade: any, quote: Quote, reason: string, forcedExit?: number) {
  const side: B3Side = trade.side;
  // Compra fecha no Bid, venda fecha no Ask.
  const marketExit = side === "buy"
    ? Number(quote.bid ?? quote.last ?? quote.ask)
    : Number(quote.ask ?? quote.last ?? quote.bid);
  const exitPx = forcedExit != null ? forcedExit : marketExit;
  const dir = side === "buy" ? 1 : -1;
  const grossPts = (exitPx - Number(trade.entry_price)) * dir;
  const qty = Number(trade.quantity) || 1;
  const grossBrl = grossPts * WIN_POINT_VALUE_BRL * qty;
  const fees = (Number(s.fee_per_contract_brl) || 0) * 2 * qty;
  const netBrl = grossBrl - fees;

  await (sb as any).from("b3_legacy_mt5_trades").update({
    exit_price: Math.round(exitPx / WIN_TICK_SIZE) * WIN_TICK_SIZE,
    exit_bid: quote.bid, exit_ask: quote.ask,
    closed_at: new Date().toISOString(),
    gross_pts: grossPts, gross_brl: grossBrl, fees_brl: fees, net_brl: netBrl,
    status: "closed", close_reason: reason,
  }).eq("id", trade.id).eq("user_id", userId);
}

async function openLegacyTrade(
  sb: SupabaseClient, userId: string, s: Settings, mode: LegacyMode, cfg: LegacyModeCfg,
  side: B3Side, quote: Quote, signalId: string | null, decisionScore: number, ctx: B3Context,
) {
  const slipPts = (Number(s.slippage_ticks) || 0) * WIN_TICK_SIZE;
  // Compra entra no Ask (+ slippage), venda entra no Bid (- slippage).
  const rawEntry = side === "buy"
    ? Number(quote.ask ?? quote.last ?? quote.bid) + slipPts
    : Number(quote.bid ?? quote.last ?? quote.ask) - slipPts;
  const entry = Math.round(rawEntry / WIN_TICK_SIZE) * WIN_TICK_SIZE;
  await (sb as any).from("b3_legacy_mt5_trades").insert({
    user_id: userId, symbol: s.mt5_symbol, mode, side, quantity: 1,
    entry_price: entry, entry_bid: quote.bid, entry_ask: quote.ask,
    stop_pts: cfg.stop_pts, gain_pts: cfg.gain_pts, slippage_pts: slipPts,
    fees_brl: 0, status: "open", quote_server: quote.server, source_engine: "legacy_b3",
    legacy_signal_id: signalId,
    legacy_mode_snapshot: { cfg, score: decisionScore, ema9: ctx.ema9, ema21: ctx.ema21, rsi: ctx.rsi } as any,
  });
}

export interface LegacyTickResult {
  status: string; signals: number; opened: number; closed: number; blocked: number;
  quote_age_s?: number; server?: string;
}

/** Loop principal: recebe tick MT5, roda robôs legados, executa simulação e persiste. */
export async function runLegacyMt5Tick(
  sb: SupabaseClient, userId: string, opts: { force?: boolean } = {},
): Promise<LegacyTickResult> {
  const res: LegacyTickResult = { status: "ok", signals: 0, opened: 0, closed: 0, blocked: 0 };

  const { data: settings } = await (sb as any).from("b3_mt5sim_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!settings) return { ...res, status: "no_settings" };
  const s = settings as Settings;

  const { data: quoteRow } = await (sb as any).from("b3_mt5sim_quotes")
    .select("*").eq("user_id", userId).eq("symbol", s.mt5_symbol)
    .order("received_at", { ascending: false }).limit(1).maybeSingle();
  if (!quoteRow) return { ...res, status: "sem_cotacao" };
  const q = quoteRow as Quote;
  const age = (Date.now() - new Date(q.received_at).getTime()) / 1000;
  res.quote_age_s = age;
  res.server = q.server ?? undefined;

  if (age > TICK_PAUSE_AGE_S) return { ...res, status: "paused_stale" };
  const staleForEntry = age > (s.quote_ttl_seconds ?? 15) || age > TICK_ENTRY_MAX_AGE_S;

  const { current: _cur, recent } = await updateM1Candle(sb, userId, q);
  const ctx = buildB3ContextFromMt5Tick(q, recent, "WIN", "WINFUT");

  const now = new Date();
  const cur = saoPauloMinutes(now);
  const startMin = hhmmToMin(s.session_start ?? "09:15");
  const endMin = hhmmToMin(s.session_end ?? "16:55");
  const insideHours = cur >= startMin && cur <= endMin;
  const forceClose = cur >= endMin;

  const realized = await realizedTodayByMode(sb, userId);
  const intendedSide: B3Side = ctx.ema9 >= ctx.ema21 ? "buy" : "sell";

  for (const mode of LEGACY_MODES) {
    const cfg = LEGACY_DEFAULTS[mode];
    const realizedToday = realized[mode] ?? 0;

    // Gerenciar posição aberta desse robô.
    const { data: openList } = await (sb as any).from("b3_legacy_mt5_trades")
      .select("*").eq("user_id", userId).eq("mode", mode).eq("status", "open");
    const open = ((openList as any[]) ?? [])[0];
    if (open) {
      const dirSign = open.side === "buy" ? 1 : -1;
      const ref = open.side === "buy" ? Number(q.bid ?? q.last) : Number(q.ask ?? q.last);
      const movePts = (ref - Number(open.entry_price)) * dirSign;
      const hitStop = movePts <= -Number(cfg.stop_pts);
      const hitGain = movePts >= Number(cfg.gain_pts);
      if (forceClose || hitStop || hitGain) {
        const reason = forceClose ? "force_close" : hitStop ? "stop" : "gain";
        await closeLegacyTrade(sb, userId, s, open, q, reason);
        res.closed++;
        continue;
      }
    }

    // Gate por travas diárias.
    const lossHit = realizedToday <= -Number(cfg.daily_loss_limit_brl);
    const gainHit = realizedToday >= Number(cfg.daily_gain_target_brl);
    if (lossHit || gainHit || !insideHours || forceClose || ctx.volatility_pct > cfg.max_volatility_pct) {
      if (!open) {
        const reason = lossHit ? "trava_perda_diaria"
          : gainHit ? "meta_diaria_atingida"
          : !insideHours ? "fora_horario"
          : forceClose ? "zeragem"
          : "volatilidade";
        await (sb as any).from("b3_legacy_mt5_signals").insert({
          user_id: userId, symbol: s.mt5_symbol, mode, intended_side: intendedSide,
          decision: "blocked", score: 0, price_bid: q.bid, price_ask: q.ask, price_last: q.last,
          spread: q.spread, tick_age_s: age, server: q.server, blocked_reason: reason,
          reason: `Bloqueado por ${reason}.`,
        });
        res.blocked++;
      }
      continue;
    }

    if (staleForEntry) {
      await (sb as any).from("b3_legacy_mt5_signals").insert({
        user_id: userId, symbol: s.mt5_symbol, mode, intended_side: intendedSide,
        decision: "blocked", price_bid: q.bid, price_ask: q.ask, price_last: q.last,
        spread: q.spread, tick_age_s: age, server: q.server,
        blocked_reason: "tick_stale", reason: `Tick com ${age.toFixed(1)}s — sem novas entradas.`,
      });
      res.blocked++;
      continue;
    }

    if (open) continue;

    // Roda o comitê legado.
    const risk: B3RiskState = {
      daily_loss_limit: cfg.daily_loss_limit_brl,
      daily_gain_target: cfg.daily_gain_target_brl,
      realized_today_brl: realizedToday,
      open_contracts: 0, max_contracts: cfg.max_contracts, requested_qty: 1,
      inside_hours: insideHours, force_close_now: forceClose, strategy_mode: mode,
    };
    const votes: B3AgentVote[] = runB3Agents(ctx, intendedSide, risk);
    const committee: B3CommitteeSettings = {
      min_approve_votes: cfg.min_approve_votes, min_confidence: cfg.min_confidence, min_score: cfg.min_score,
    };
    const decision = buildB3Decision(votes, intendedSide, committee);

    const { data: sigIns } = await (sb as any).from("b3_legacy_mt5_signals").insert({
      user_id: userId, symbol: s.mt5_symbol, mode, intended_side: intendedSide,
      decision: decision.final, score: decision.score,
      price_bid: q.bid, price_ask: q.ask, price_last: q.last, spread: q.spread,
      tick_age_s: age, server: q.server,
      reason: `Comitê legado ${mode}: score ${decision.score}.`,
      blocked_reason: decision.final === "approved" ? null : decision.final,
      votes: votes as any,
    }).select("id").single();

    res.signals++;
    if (decision.final === "approved") {
      await openLegacyTrade(sb, userId, s, mode, cfg, intendedSide, q, sigIns?.id ?? null, decision.score, ctx);
      res.opened++;
    } else {
      res.blocked++;
    }
  }

  return res;
}
